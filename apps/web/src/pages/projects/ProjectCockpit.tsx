import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, LayoutDashboard, Maximize2, MessageCircle, PanelRight, Search } from 'lucide-react';
import {
  PROJECT_HEALTH_LABEL,
  cockpitPath,
  graphNodeLabels,
  isProjectCockpitPane,
  hasSpokenConversation,
  paneFromProjectPath,
  fileIsBare,
  projectNextStep,
  paneForTalk,
  sittingFromCitedId,
  sittingFromTurn,
  sittingWithField,
  waitingOnCanvas,
  type AgentStep,
  type CockpitPathExtra,
  type CopilotTurn,
  type DdProject,
  type EvidenceItem,
  type ProjectCockpitPane,
  type ReadingStreamEvent,
  type TalkSitting,
  type WaitingEntry,
} from '@realytica/shared';
import { api, type ProjectChatResponse } from '../../lib/api';
import { uploadLargeDocument } from '../../lib/workspace-api';

/** Past this, a document goes up in parts: a serverless request carries 4.5 MB at most. */
const LARGE_FILE_BYTES = 3.5 * 1024 * 1024;
import {
  applyReadingEvent,
  finishReading,
  newReadingSession,
  readingFileFromProposal,
  type ReadingFile,
  type ReadingSession,
  type SourceFocus,
} from '../../lib/reading';
import { ReadingDesk } from '../../components/reading/ReadingDesk';
import { CopilotPanel } from '../../components/CopilotPanel';
import { Badge, Spinner, cn, useToast } from '../../components/ui/kit';
import { SPRING, ScreenEnter, motion } from '../../lib/motion';
import { DESKTOP_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { EMPTY_CHAT_WIDTH, LAYOUTS, clampChatWidth, readChatWidth, writeChatWidth } from './cockpit/layout';
import type { CockpitLayout } from './cockpit/layout';
import { healthTone } from './shared';
import { RouteErrorBoundary } from '../../components/layout/ErrorBoundary';
import type { ProjectOutlet } from './ProjectLayout';
import { ProjectCommandBar } from './cockpit/ProjectCommandBar';
import { CockpitPaneStrip, ProjectPicker, ReviewPill, WORKSTREAM_PANE, paneLabel } from './cockpit/rail';
import { StageTimeline } from '../../components/departments/StageTimeline';
import { AlertsBell } from '../../components/departments/AlertsBell';
import type { PhaseOpen } from '../../components/project/PhaseRecord';
import { SittingChip, SittingDock } from './cockpit/SittingPeek';
import { TurnWaiting, UndoBar, WaitingHere } from './cockpit/Waiting';

function sameSitting(a: TalkSitting, b: TalkSitting): boolean {
  return (
    a.kind === b.kind
    && a.extra.checkId === b.extra.checkId
    && a.extra.scopeId === b.extra.scopeId
    && a.extra.ddId === b.extra.ddId
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
  /*
   * No evidence fallback. On the evidence register an `evidenceId` opens the
   * document viewer, a modal over the chat — so falling back to the first
   * highlighted id opened the first of nine documents whenever a batch was
   * approved, hiding the message that offered the next step. The rows are
   * highlighted either way; a document opens only when the server names it
   * (one card approved, or an answer quoting a page).
   */
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

/*
 * The work surface deliberately paints no background of its own.
 *
 * It carried `bg-surface-1` for a long time, which is not a class: the token
 * is `surface`, so Tailwind emitted nothing and the section has been
 * transparent all along, showing the page through it. The obvious repair is
 * to spell it `bg-surface` — and that is a regression, measured rather than
 * guessed.
 *
 * `Card` is itself `bg-surface`. In dark mode the pane is #0d0d0d today and
 * every card on it is #1a1a19, so the cards visibly sit on something. Paint
 * the pane `bg-surface` and both become #1a1a19: identical, and a card is
 * reduced to a one-pixel ring and a shadow on a field of its own colour.
 * Light mode does the same thing three shades apart, where nobody would
 * notice either way.
 *
 * So the accident was doing something worth keeping — cards need a darker
 * field to lift off — and the dead class is removed rather than fixed, with
 * the reasoning here so the next person to notice it does not "correct" it.
 */
const MOBILE_WORK_SURFACE = 'min-h-0 min-w-0 flex-col overflow-hidden';

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
  const params = useParams<{ ddId?: string; scopeId?: string; department?: string; workstream?: string }>();
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
  /*
   * The reading desk: documents being read, and their values decided.
   *
   * The chat says what happened; the canvas shows it — the page being
   * scanned, each fact as it comes off it, and then each value waiting on its
   * document with the two decisions beside it. Open while a turn reads, and
   * whenever a document is opened for review.
   */
  const [reading, setReading] = useState<ReadingSession | null>(null);
  const [deskOpen, setDeskOpen] = useState(false);
  const [deskPin, setDeskPin] = useState<string | null>(null);
  const [sourceFocus, setSourceFocus] = useState<SourceFocus | null>(null);
  /* The last instruction the chat carried out, for a few seconds after: the way to take it back. */
  const [undo, setUndo] = useState<{ token: string; label: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  /* A decision on the canvas in flight. */
  const [deciding, setDeciding] = useState(false);
  const projectRef = useRef(project);
  projectRef.current = project;
  const [mobileSurface, setMobileSurface] = useState<MobileSurface>(() =>
    paneFromProjectPath(typeof window === 'undefined' ? '' : window.location.pathname) === 'overview' ? 'chat' : 'work',
  );

  /*
   * "Nobody has talked here yet" — not "the array is empty".
   *
   * Every work-pane edit logs a synthetic turn and a one-word reply, so a file
   * nobody has ever asked a question on still reports a conversation, and the
   * thread got the full 520px to display its own bookkeeping.
   */
  const threadEmpty = !hasSpokenConversation(project);

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
      setDeskOpen(false);
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

  /* A record opened from the stage look-back: decisions and reports have panes of their own. */
  const openFromStage: PhaseOpen = useCallback(
    (kind, id) => {
      if (kind === 'decision') goPane('decisions');
      else if (kind === 'report') goPane('reports');
      else openCited(id);
    },
    [goPane, openCited],
  );

  const applyResult = useCallback(
    (response: ProjectChatResponse) => {
      /*
       * Documents this response filed, shown being filed.
       *
       * Approving a document card writes its facts onto the register, and the
       * register is where that ends up — but the moment of filing is worth
       * seeing: the desk opens on the documents, their facts turn green, and
       * then it hands back to the register with the rows lit.
       */
      const before = new Map((projectRef.current.chatProposals ?? []).map((p) => [p.id, p.status]));
      const filedNow = (response.project.chatProposals ?? []).filter(
        (p) => p.kind === 'file_evidence' && p.status === 'committed' && before.get(p.id) === 'proposed',
      );
      if (filedNow.length) {
        setReading((prev) => {
          const keys = filedNow.map((p) => String(p.payload.storageKey ?? '')).filter(Boolean);
          // One document filed while the desk holds it turns green where it stands.
          if (keys.length === 1 && prev?.files.some((f) => f.key === keys[0])) return prev;
          /*
           * Several are stepped through, so the filing is a desk of its own: a
           * fresh one keyed by its own id, carrying which documents to step
           * through. It keeps what the desk already held — its pages and its
           * facts — and adds any filed document it did not.
           */
          const held = prev?.files ?? [];
          const added = filedNow
            .filter((p) => !held.some((f) => f.key === p.payload.storageKey))
            .map(readingFileFromProposal)
            .filter((f): f is NonNullable<typeof f> => Boolean(f));
          const files = [...held, ...added];
          return files.length ? { ...newReadingSession('review'), files, finished: true, filingKeys: keys } : prev;
        });
        setSourceFocus(null);
        setDeskOpen(true);
      }
      setProject(response.project);
      const ids = response.highlightIds ?? [];
      setHighlightIds(ids);
      const waitingNow = response.proposals.filter((p) => p.status === 'proposed').length;
      setLiveLabel(response.commands[0] ?? (waitingNow ? `${waitingNow} waiting on the canvas` : null));
      setUndo(response.undo ?? null);
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

  /*
   * One sitting per opening of this project.
   *
   * The thread used to run forever: opening a file worked on for a week put
   * you at the bottom of every exchange anybody had ever had about it. Minting
   * an id here means the panel opens empty on what you are doing now, and the
   * past becomes somewhere you go rather than something you scroll past.
   *
   * Keyed to the project so switching files starts a new sitting rather than
   * continuing the last one under a different heading.
   */
  const [sessionId, sessionStartedAt] = useMemo(() => {
    const now = Date.now();
    return [`ses_${project.id.slice(-6)}_${now.toString(36)}`, new Date(now).toISOString()] as const;
  }, [project.id]);

  /*
   * What is still waiting from an earlier sitting.
   *
   * Opening the file starts a fresh chat, which is right — and it must not
   * hide that values read yesterday are still waiting for a decision. One
   * line leads the new chat, pointing at where they wait; the decisions are
   * made there, not here.
   */
  const waiting = useMemo(() => waitingOnCanvas(project), [project]);
  const leadTurn = useMemo((): CopilotTurn | undefined => {
    const here = (project.conversation ?? []).filter((t) => t.sessionId === sessionId || (!t.sessionId && t.at >= sessionStartedAt));
    const shownCards = new Set(here.flatMap((t) => t.proposalIds ?? []));
    const shownDocs = new Set(here.flatMap((t) => t.citedEvidenceIds ?? []));
    const earlier = waiting.entries.filter((e) => (e.proposalId ? !shownCards.has(e.proposalId) : e.evidenceId ? !shownDocs.has(e.evidenceId) : false));
    const count = earlier.reduce((n, e) => n + e.count, 0);
    if (!count) return undefined;
    return {
      id: 'waiting-from-earlier',
      role: 'assistant',
      text: `${count === 1 ? 'One thing is' : `${count} things are`} still waiting for you from earlier.`,
      at: sessionStartedAt,
      citedEvidenceIds: earlier.map((e) => e.evidenceId).filter((id): id is string => Boolean(id)),
      proposalIds: earlier.map((e) => e.proposalId).filter((id): id is string => Boolean(id)),
    } as unknown as CopilotTurn;
  }, [project.conversation, waiting, sessionId, sessionStartedAt]);
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
      // This turn's first document starts a fresh reading; the rest add to it.
      let fresh = true;
      const onReading = (event: ReadingStreamEvent) => {
        const isFresh = fresh;
        fresh = false;
        setReading((prev) => applyReadingEvent(isFresh || !prev ? newReadingSession('live') : prev, event, { localFiles: files }));
        if (isFresh) {
          setSourceFocus(null);
          setDeskPin(null);
          setDeskOpen(true);
        }
      };
      try {
        /*
         * A document too big for one request — a 70 MB merged title bundle —
         * goes into the vault in parts first; the chat then reads what was
         * filed rather than carrying the bytes itself.
         */
        const big = (files ?? []).filter((f) => f.size >= LARGE_FILE_BYTES);
        const small = (files ?? []).filter((f) => f.size < LARGE_FILE_BYTES);
        for (const [n, file] of big.entries()) {
          setLiveLabel(`Filing ${file.name} in parts (${n + 1} of ${big.length})…`);
          await uploadLargeDocument(project.id, file, { onProgress: (share) => setLiveLabel(`Filing ${file.name}: ${Math.round(share * 100)}%`) });
        }
        if (big.length) setLiveLabel(null);
        const ask = question.trim() || (big.length && !small.length ? 'Read the filed documents' : question);
        const response = small.length
          ? await api.projectChatFiles(project.id, { question: ask, viewContext: pane, files: small, sitting, sessionId }, { onStep, onReading, signal: ac.signal })
          : await api.projectChat(project.id, { question: ask, viewContext: pane, sitting, sessionId }, { onStep, onReading, signal: ac.signal });
        applyResult(response);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (e instanceof Error && e.name === 'AbortError') return;
        throw e;
      } finally {
        if (!fresh) setReading((prev) => (prev && prev.mode === 'live' ? finishReading(prev) : prev));
        if (abortRef.current === ac) {
          abortRef.current = null;
          setAsking(false);
          setChatSteps([]);
        }
      }
    },
    [project.id, pane, params.ddId, params.scopeId, searchParams, applyResult, sessionId],
  );

  /**
   * Documents opened for review: their pages, and the values waiting on them.
   * Built from the register rows, so a document filed last week reviews
   * exactly as one read a minute ago.
   */
  const openReview = useCallback((evidenceIds: string[], pin?: string) => {
    const files: ReadingFile[] = [];
    for (const id of evidenceIds) {
      const row = projectRef.current.evidence.find((e) => e.id === id);
      const file = row?.attachments.find((a) => a.storageKey) ?? row?.attachments[0];
      if (!row || !file) continue;
      files.push({
        key: file.storageKey,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        source: { kind: 'evidence', evidenceId: row.id, fileId: file.id },
        phase: 'done',
        label: row.documentType,
        method: row.readMethod,
        facts: [],
        modelFacts: [],
      });
    }
    if (!files.length) return;
    const pinned = pin ? projectRef.current.evidence.find((e) => e.id === pin)?.attachments[0]?.storageKey : undefined;
    setReading({ ...newReadingSession('review'), files, finished: true });
    setSourceFocus(null);
    setDeskPin(pinned ?? files[0]!.key);
    setDeskOpen(true);
    setMobileSurface('work');
  }, []);

  /*
   * Where a jump to something waiting lands: the work surface keeps its
   * scroll from the pane before, so the list at the top of a register — or
   * the values on a check — would open out of sight.
   */
  const workScrollRef = useRef<HTMLDivElement>(null);
  const [landOn, setLandOn] = useState<{ kind: 'check' | 'pane'; at: number } | null>(null);
  useEffect(() => {
    if (!landOn) return;
    const t = window.setTimeout(() => {
      const root = workScrollRef.current;
      const el = root?.querySelector<HTMLElement>(`[data-waiting-anchor="${landOn.kind}"]`) ?? root?.querySelector<HTMLElement>('[data-waiting-anchor]');
      if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else root?.scrollTo({ top: 0 });
    }, 220);
    return () => window.clearTimeout(t);
  }, [landOn, location.pathname, location.search]);

  /** Wherever the next thing waiting is: a document opens for review, anything else opens where it waits. */
  const goWaiting = useCallback(
    (entry?: WaitingEntry) => {
      const next = entry ?? waiting.entries[0];
      if (!next) return;
      if (next.kind === 'facts' && next.evidenceId) {
        const documents = waiting.entries.filter((e) => e.kind === 'facts' && e.evidenceId).map((e) => e.evidenceId!);
        openReview(documents, next.evidenceId);
        return;
      }
      goPane(next.pane, next.extra);
      setLandOn({ kind: next.pane === 'scope' ? 'check' : 'pane', at: Date.now() });
    },
    [waiting, openReview, goPane],
  );

  /** Decided on the canvas: no chat turn, the project as it now stands. */
  const acceptWaiting = useCallback(
    async (id: string, payload?: Record<string, unknown>) => {
      setDeciding(true);
      try {
        const { project: next, offered } = await api.acceptWaiting(project.id, id, payload);
        setProject(next);
        if (offered) toast(`Accepted — ${offered} check${offered === 1 ? '' : 's'} can take values from the documents`, 'good');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'That could not be accepted', 'critical');
      } finally {
        setDeciding(false);
      }
    },
    [project.id, setProject, toast],
  );

  const setAsideWaiting = useCallback(
    async (id: string) => {
      setDeciding(true);
      try {
        const { project: next } = await api.setAsideWaiting(project.id, id);
        setProject(next);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'That could not be set aside', 'critical');
      } finally {
        setDeciding(false);
      }
    },
    [project.id, setProject, toast],
  );

  /* The way back stays a few seconds, then goes: an old undo is a trap, not a convenience. */
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 15000);
    return () => window.clearTimeout(t);
  }, [undo]);

  const takeBack = useCallback(async () => {
    if (!undo) return;
    setUndoing(true);
    try {
      const { project: next } = await api.undoInstruction(project.id, undo.token);
      setProject(next);
      setHighlightIds([]);
      setLiveLabel(null);
      toast('Undone', 'good');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That could not be undone', 'critical');
    } finally {
      setUndo(null);
      setUndoing(false);
    }
  }, [undo, project.id, setProject, toast]);

  /*
   * A question asked from outside the workspace arrives as `?ask=`. It is asked
   * once, and the parameter is dropped so a reload does not ask it again.
   */
  const [, setSearchParams] = useSearchParams();
  const asked = useRef(false);
  useEffect(() => {
    const q = searchParams.get('ask');
    if (!q || asked.current) return;
    asked.current = true;
    setPendingQuestion(q);
    const next = new URLSearchParams(searchParams);
    next.delete('ask');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

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
  const next = useMemo(() => projectNextStep(project), [project]);
  const nodeLabels = useMemo(() => graphNodeLabels(project), [project]);

  /*
   * What to offer, from where the file stands.
   *
   * These used to end with "Set owner to Priya Shah" on every project — a
   * demo name offered as the thing to do next on a stranger's file. Each chip
   * now follows from the state: documents missing, findings open, a report
   * worth generating. Nothing waiting is offered here: it is decided on the
   * canvas, and the chips are things to ask.
   */
  const suggestions = useMemo(() => {
    const rows: string[] = [];
    const filed = project.evidence.filter((e) => (e.attachments ?? []).length).length;
    // Filed before the reader existed, or that it could not read then: the
    // file is there, but nothing on the row says what it states.
    const unread = project.evidence.filter(
      (e) => (e.attachments ?? []).length && !(e.facts ?? []).length && !e.modelReadAt && e.status !== 'rejected' && e.status !== 'superseded',
    ).length;
    const material = project.findings.filter(
      (f) => (f.severity === 'critical' || f.severity === 'high') && !['closed', 'rejected', 'duplicate', 'superseded'].includes(f.status),
    ).length;
    if (filed === 0) {
      // A sample project with nothing on it: the fastest way to see what this
      // does is the bundled sample set, read through the same path as a real
      // upload. Never on a client file, where it would put invented deeds
      // beside real ones.
      // Same predicate as the next step itself, so the chip and the step
      // never disagree about whether the file is bare.
      if (fileIsBare(project)) rows.push(next.title);
      rows.push('What can you do?', 'What documents do I need?');
    } else {
      if (unread) rows.push('Read the filed documents');
      rows.push('Summarise this file');
      if (material) rows.push('Which findings are critical?');
      rows.push("What's missing?");
      if (material && !project.reports.some((r) => r.kind === 'red_flag')) rows.push('Generate the red flag report');
    }
    if (pendingDrafts) rows.push('Review pending drafts');
    if (!rows.includes("What's next?") && rows.length < 4) rows.push("What's next?");
    return [...new Set(rows)].slice(0, 4);
  }, [project, next.title, pendingDrafts]);

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

  const workOutlet: ProjectOutlet = {
    ...outlet,
    highlightIds,
    onAcceptWaiting: (id, payload) => void acceptWaiting(id, payload),
    onSetAsideWaiting: (id) => void setAsideWaiting(id),
    waitingBusy: deciding || asking,
    onReviewDocument: (evidenceId) => openReview([evidenceId], evidenceId),
    onOpenCited: openCited,
  };

  const chat = (
    <CopilotPanel
      sessionId={sessionId}
      sessionStartedAt={sessionStartedAt}
      leadTurn={leadTurn}
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
      /*
        The pane is already in the request and was nowhere on the screen.
        Every question carries `viewContext: pane`, so the copilot has always
        known which surface you were looking at — and the composer offered
        three generic examples instead of saying so. Naming it costs a word
        and turns an invisible capability into a visible one.
      */
      /*
       * The placeholder names the pane and stops.
       *
       * It used to carry two example commands as well — "Set owner to … ·
       * Guide me" — while the chip row directly above offered "Guide me" and
       * "Set owner to Priya Shah" as buttons you can actually press. The same
       * two suggestions, twice, one of them unclickable.
       */
      placeholder={`Ask about ${paneLabel(pane, params)}…`}
      dock={
        dockTalk && !dockIsEcho && (dockTalk.kind === 'check' || dockTalk.kind === 'scope') ? (
          <SittingDock
            project={project}
            talk={dockTalk}
            busy={asking}
            compact={isDesktop}
            onClose={() => setDockTalk(null)}
            onOpen={goPane}
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
            <TurnWaiting turn={turn} waiting={waiting} onGo={goWaiting} />
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

  /* Once the desk's documents are settled, the next thing waiting that is not on them. */
  const deskNext = useMemo(() => {
    if (!reading) return null;
    const onDesk = new Set(reading.files.map((f) => f.key));
    const after = waiting.entries.find(
      (e) => !(e.kind === 'facts' && project.evidence.some((row) => row.id === e.evidenceId && row.attachments.some((a) => onDesk.has(a.storageKey)))),
    );
    if (!after) return null;
    return {
      label: after.kind === 'facts' ? `Next document: ${after.title}` : after.pane === 'scope' ? 'Values on the checks' : `Next: ${paneLabel(after.pane)}`,
      onGo: () => {
        setDeskOpen(false);
        goWaiting(after);
      },
    };
  }, [reading, waiting, project.evidence, goWaiting]);

  const desk =
    deskOpen && reading ? (
      <ReadingDesk
        // A new reading, or a review, starts the desk afresh: its pacing is its own.
        key={reading.id}
        project={project}
        session={reading}
        focus={sourceFocus}
        pinKey={deskPin}
        onFocus={setSourceFocus}
        onDecided={setProject}
        next={deskNext}
        onClose={() => {
          setDeskOpen(false);
          setSourceFocus(null);
        }}
      />
    ) : null;

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
              {/* Each pane arrives when it is switched to, rather than swapping in place. */}
              <ScreenEnter id={location.pathname} className="h-full">
                <Outlet context={workOutlet} />
              </ScreenEnter>
            </Suspense>
          </RouteErrorBoundary>
        </div>
      ) : (
        <div ref={workScrollRef} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 [container-type:inline-size] sm:p-4">
          <WaitingHere
            project={project}
            pane={pane}
            waiting={waiting}
            sittingCheckId={searchParams.get('check')}
            busy={deciding || asking}
            onAccept={(id, payload) => void acceptWaiting(id, payload)}
            onSetAside={(id) => void setAsideWaiting(id)}
            onGo={goWaiting}
          />
          {/* One broken pane must not take the project tabs with it, and the
              two lazily-loaded tabs need somewhere to wait. */}
          <RouteErrorBoundary>
            <Suspense fallback={<PaneWaiting />}>
              {/* Each pane arrives when it is switched to, rather than swapping in place. */}
              <ScreenEnter id={location.pathname}>
                <Outlet context={workOutlet} />
              </ScreenEnter>
            </Suspense>
          </RouteErrorBoundary>
        </div>
      )}
      {undo ? <UndoBar label={undo.label} busy={undoing} onUndo={() => void takeBack()} onDismiss={() => setUndo(null)} /> : null}
    </>
  );

  /* What a phone switches between: the conversation, and the pane it is about. */
  const surfaces = [
    { key: 'chat', label: 'Chat', icon: MessageCircle, go: () => setMobileSurface('chat') },
    {
      key: 'work',
      label: paneLabel(pane, params),
      icon: LayoutDashboard,
      go: () => {
        setFocusMode(false);
        setMobileSurface('work');
      },
    },
  ] as const;

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden lg:h-[calc(100dvh-56px)]">
      {isDesktop ? (
        // `relative`: the stage's record hangs from this bar, across its width, rather than from the track inside it.
        <div className="relative flex shrink-0 items-center gap-3 border-b border-hairline bg-surface px-4 py-2">
          {/*
            The reference and the name are NOT repeated here.
            The top bar's project switcher carries both, permanently, forty
            pixels above this row — so the cockpit was printing "RYT-0003" and
            the project name twice, stacked, before a reader reached anything
            about the project. What this row is for is the way back and the
            health of the file; the switcher says which file it is.
          */}
          <Link
            to="/portfolio"
            className="group inline-flex h-8 shrink-0 items-center gap-1 rounded-lg pl-1.5 pr-2.5 text-[13px] font-medium text-ink-secondary ring-1 ring-inset ring-[var(--ring)] transition-colors duration-quick hover:bg-sunken hover:text-ink"
          >
            <ChevronLeft size={15} className="transition-transform duration-quick ease-state group-hover:-translate-x-0.5" />
            Portfolio
          </Link>
          {/* The name is the top bar's switcher, forty pixels up; this row
              carries the way back, where in the project you are, the stage
              it has reached and the state of the file. */}
          <ProjectPicker pane={pane} project={project} department={params.department} workstream={params.workstream} onGo={goPane} waiting={waiting} />
          <StageTimeline project={project} onChanged={setProject} onOpen={openFromStage} />
          {waiting.total > 0 ? <ReviewPill n={waiting.total} onClick={() => goWaiting()} /> : null}
          <Badge tone={healthTone(project.health)}>{PROJECT_HEALTH_LABEL[project.health]}</Badge>
          <AlertsBell project={project} onChanged={setProject} onOpenWorkstream={(key) => goPane(WORKSTREAM_PANE[key] ?? 'workstream', { workstream: key })} />
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg bg-sunken pl-2.5 pr-1.5 text-[12px] text-ink-muted ring-1 ring-inset ring-[var(--ring)] transition-colors duration-quick hover:text-ink"
          >
            <Search size={13} aria-hidden />
            Command
            <kbd className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setFocusMode((v) => !v)}
            title={focusMode ? 'Leave focus' : 'Focus the conversation (⌘.)'}
            aria-pressed={focusMode}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] ring-1 ring-inset transition-colors duration-quick',
              focusMode ? 'bg-ink text-[var(--text-inverse)] ring-ink' : 'bg-surface text-ink-secondary ring-[var(--ring)] hover:text-ink',
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
        <div className="flex h-14 shrink-0 items-center gap-1 border-b border-hairline bg-surface px-1.5 pt-[env(safe-area-inset-top)] min-[400px]:gap-1.5 min-[400px]:px-2">
          <Link to="/portfolio" aria-label="Back to the portfolio" className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-secondary hover:bg-sunken hover:text-ink coarse:size-11">
            <ChevronLeft size={18} />
          </Link>
          {/* Where you are keeps a few words however narrow the phone: the
              stage pill beside it truncates first. It is the selector itself,
              so the place is named once and is also the way to any other. */}
          <div className="min-w-[4.5rem] flex-1 leading-tight">
            <p className="truncate text-[11px] font-medium text-ink-muted">{project.name}</p>
            <ProjectPicker pane={pane} project={project} department={params.department} workstream={params.workstream} onGo={goPane} waiting={waiting} dense />
          </div>
          {/*
            Held sideways a phone has width to spare and almost no height, so
            the switch between the chat and the canvas moves up here and the
            bar at the foot goes: sixty pixels back for the work itself.
          */}
          <div role="group" aria-label="Show" className="hidden shrink-0 items-center gap-0.5 rounded-xl bg-sunken p-0.5 ring-1 ring-inset ring-[var(--ring)] short:flex">
            {surfaces.map((item) => {
              const on = mobileSurface === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.go}
                  aria-pressed={on}
                  className={cn(
                    'relative flex h-9 max-w-[11rem] items-center gap-1.5 rounded-[10px] px-3 text-[13px] transition-colors duration-quick coarse:h-10',
                    on ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {on ? <motion.span layoutId="cockpit-surface-short" aria-hidden className="absolute inset-0 rounded-[10px] bg-surface shadow-card ring-1 ring-[var(--ring)]" transition={SPRING.snappy} /> : null}
                  <item.icon size={15} className="relative shrink-0" />
                  <span className="relative truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
          <StageTimeline project={project} onChanged={setProject} onOpen={openFromStage} compact />
          <AlertsBell project={project} onChanged={setProject} onOpenWorkstream={(key) => goPane(WORKSTREAM_PANE[key] ?? 'workstream', { workstream: key })} />
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            aria-label="Run a command"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-secondary hover:bg-sunken hover:text-ink coarse:size-11"
          >
            <Search size={17} />
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
              'flex min-h-0 min-w-0 flex-col border-r border-hairline bg-surface',
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
              /*
               * A one-pixel transparent strip is discoverable only by trial:
               * nothing says the boundary can be moved until you happen to
               * put the cursor on exactly the right column. The group gets a
               * wider hit area than the line it draws, and a grip that shows
               * on hover and on keyboard focus.
               */
              className="group relative flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-transparent focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'h-8 w-[3px] rounded-full bg-[var(--ring)] opacity-0 transition-opacity duration-quick ease-state',
                  'group-hover:opacity-100 group-focus-visible:bg-brand group-focus-visible:opacity-100',
                  dragging && 'bg-brand opacity-100',
                )}
              />
            </div>
          ) : null}

          {spec.rightPane ? (
            /*
              No background here on purpose, and `bg-surface-1` — which named
              no token and painted nothing — is gone rather than repaired.
              See the note above `MOBILE_WORK_SURFACE`.
            */
            <section aria-label="Work surface" className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {/* The reading takes the whole canvas while it is open; closing it is the way back to the panes. */}
              {desk ?? (
                <>
                  <CockpitPaneStrip
                    pane={pane}
                    project={project}
                    ddId={params.ddId}
                    scopeId={params.scopeId}
                    department={params.department}
                    workstream={params.workstream}
                    overdue={overdue}
                    pendingDrafts={pendingDrafts}
                    onGo={goPane}
                    waiting={waiting}
                    wrap
                  />
                  {workBody}
                </>
              )}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <section
            aria-label="Conversation"
            hidden={mobileSurface !== 'chat'}
            className={cn('min-h-0 flex-col bg-surface', mobileSurface === 'chat' ? 'flex flex-1' : 'hidden')}
          >
            <div className="flex min-h-0 flex-1 flex-col p-3">{chat}</div>
          </section>
          <section
            aria-label="Work surface"
            hidden={mobileSurface !== 'work'}
            className={cn(
              MOBILE_WORK_SURFACE,
              'relative',
              mobileSurface === 'work' ? 'flex flex-1' : 'hidden',
            )}
          >
            {desk ?? (
              <>
                <CockpitPaneStrip
                  pane={pane}
                  project={project}
                  ddId={params.ddId}
                  scopeId={params.scopeId}
                  department={params.department}
                  workstream={params.workstream}
                  overdue={overdue}
                  pendingDrafts={pendingDrafts}
                  onGo={goPane}
                  waiting={waiting}
                  onReview={() => goWaiting()}
                />
                {workBody}
              </>
            )}
          </section>

          <nav
            aria-label="Cockpit"
            className="flex shrink-0 gap-1 border-t border-hairline bg-surface/95 px-2 pt-1.5 backdrop-blur pb-[max(0.5rem,env(safe-area-inset-bottom))] short:hidden"
          >
            {surfaces.map((item) => {
              const on = mobileSurface === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.go}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'relative flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-[13px] transition-colors duration-quick active:scale-[0.98]',
                    on ? 'font-semibold text-ink' : 'text-ink-muted',
                  )}
                >
                  {/* The surface you are on wears the pill, and it slides when you switch. */}
                  {on ? <motion.span layoutId="cockpit-surface" aria-hidden className="absolute inset-0 rounded-xl bg-sunken ring-1 ring-inset ring-[var(--ring)]" transition={SPRING.snappy} /> : null}
                  <item.icon size={18} className="relative shrink-0" />
                  <span className="relative truncate">{item.label}</span>
                </button>
              );
            })}
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
