import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, Outlet, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, LayoutDashboard, Maximize2, MessageCircle, PanelRight, Search } from 'lucide-react';
import {
  STAGES,
  STAGE_WORD,
  WAITING_FROM_EARLIER,
  actorOf,
  chatLinkLabels,
  chatSessions,
  chatPlaceLabel,
  chatPrompts,
  cockpitPath,
  isProjectCockpitPane,
  hasSpokenConversation,
  paneFromProjectPath,
  placeAtStage,
  placeOfRecord,
  projectNextStep,
  paneForTalk,
  sittingFromCitedId,
  sittingFromTurn,
  sittingWithField,
  stageInAddress,
  stageInView,
  waitingOnCanvas,
  type AgentStep,
  type ChatPlace,
  type ChoicePin,
  type CockpitPathExtra,
  type CopilotTurn,
  type DdProject,
  type EvidenceItem,
  type ProjectCockpitPane,
  type ReadingStreamEvent,
  type StageKey,
  type TalkSitting,
  type TurnChip,
  type WaitingEntry,
} from '@realytica/shared';
import { api, type ProjectChatResponse } from '../../lib/api';
import { carriedQuestion } from '../../components/chat/carried-question';
import { liveTurns, mayDeleteChats, mintSitting, sittingKept, waitingElsewhere, type Sitting } from '../../components/chat/chat-list';
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
import { mustFitOneMessage, readyToSend } from '../../lib/site-capture';
import { ReadingDesk } from '../../components/reading/ReadingDesk';
import { CopilotPanel } from '../../components/CopilotPanel';
import { Spinner, cn, useToast } from '../../components/ui/kit';
import { SPRING, ScreenEnter, motion } from '../../lib/motion';
import { DESKTOP_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { useMe } from '../../lib/useMe';
import { EMPTY_CHAT_WIDTH, LAYOUTS, clampChatWidth, readChatWidth, writeChatWidth } from './cockpit/layout';
import type { CockpitLayout } from './cockpit/layout';
import { RouteErrorBoundary } from '../../components/layout/ErrorBoundary';
import type { ProjectOutlet } from './ProjectLayout';
import { ProjectCommandBar } from './cockpit/ProjectCommandBar';
import { CockpitPaneStrip, ProjectPicker, WORKSTREAM_PANE, menuPlaceOf, paneLabel } from './cockpit/rail';
import { PROJECT_BAR_SLOT } from '../../components/layout/TopBar';
import { StagePill, StageTimeline } from '../../components/departments/StageTimeline';
import { AlertsBell } from '../../components/departments/AlertsBell';
import type { PhaseOpen } from '../../components/project/PhaseRecord';
import { SittingChip, SittingDock } from './cockpit/SittingPeek';
import { TurnWaiting, WaitingHere } from './cockpit/Waiting';

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

/**
 * What the address carries for a page the chat opened.
 *
 * The stage travels with whatever else is named: a reply that opens a page
 * says which stage it is looked at in, and one that says none leaves the
 * stage in view as it is.
 */
function extrasForNavigation(project: DdProject, target: ProjectCockpitPane, ids: string[], nav?: CockpitPathExtra): CockpitPathExtra {
  return { ...recordForNavigation(project, target, ids, nav), ...(nav?.stage ? { stage: nav.stage } : {}) };
}

function recordForNavigation(
  project: DdProject,
  target: ProjectCockpitPane,
  ids: string[],
  nav?: CockpitPathExtra,
): CockpitPathExtra {
  if (nav && (nav.ddId || nav.scopeId || nav.checkId || nav.node || nav.evidenceId || nav.findingId || nav.riskId || nav.actionId || nav.assetId || nav.department || nav.workstream || nav.item)) {
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
      // A department's or a function's page, and the part of it to land on with the record to mark there.
      department: nav.department,
      workstream: nav.workstream,
      section: nav.section,
      item: nav.item,
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
  // Who is signed in, for the one control here that is the firm's own people's alone.
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ projectId?: string; ddId?: string; scopeId?: string; department?: string; workstream?: string }>();
  const [searchParams] = useSearchParams();
  const pane: ProjectCockpitPane = paneFromProjectPath(location.pathname);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  /*
   * The stage being looked at.
   *
   * The address says it (`?stage=land`), and says nothing while it is the
   * project's own. Links inside a project are built in dozens of places and
   * none of them names a stage, so the stage is carried: an address that
   * arrives without one is looked at in the stage of the page before it, and
   * is then given the word, so a reload or a pasted link opens the same
   * thing. Going back or forward carries nothing. There the address is what
   * it was when it was left, and one without a word was left at the
   * project's own stage.
   *
   * While another project is loading, the one on screen is not the one the
   * address names, so nothing is carried to it and its address is left alone.
   */
  const navigationType = useNavigationType();
  const loaded = params.projectId === project.id;
  const [carried, setCarried] = useState<{ project: string; stage: StageKey } | null>(null);
  const place = useMemo(() => menuPlaceOf(pane, { department: params.department, workstream: params.workstream }), [pane, params.department, params.workstream]);
  const stageWord = searchParams.get('stage');
  const stage = useMemo(
    () =>
      stageInView(project, {
        word: stageWord,
        carried: loaded && navigationType !== 'POP' && carried?.project === project.id ? carried.stage : undefined,
        fn: place.fn,
      }),
    [project, stageWord, loaded, navigationType, carried, place.fn],
  );
  const addressWord = stageInAddress(project, stage) ?? null;
  /*
   * Where the person is, as the chat is told it: the page and the stage it is
   * looked at in. It goes with every question, so "what is missing" on Title
   * is answered about Title, and a stage named in the chat moves the page the
   * way the track would.
   */
  const here = useMemo<ChatPlace>(
    () => ({ pane, ...(place.department ? { department: place.department } : {}), ...(place.fn ? { fn: place.fn } : {}), stage }),
    [pane, place.department, place.fn, stage],
  );
  useEffect(() => {
    if (!loaded) return;
    setCarried((was) => (addressWord === null ? null : was?.project === project.id && was.stage === stage ? was : { project: project.id, stage }));
    if (stageWord === addressWord) return;
    // A page under this one may have sent the address elsewhere in this same pass: one that redirects does. The
    // address is then no longer the one read here, and writing the word onto the old one would undo the redirect
    // for good. The render that follows reads the new address and gives the word to that.
    const read = new URL(`${location.pathname}${location.search}`, window.location.origin);
    if (read.pathname !== window.location.pathname || read.search !== window.location.search) return;
    const next = new URLSearchParams(location.search);
    if (addressWord) next.set('stage', addressWord);
    else next.delete('stage');
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true, state: location.state });
  }, [loaded, project.id, stage, stageWord, addressWord, location.pathname, location.search, location.hash, location.state, navigate]);

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
  /* Whether a voice note can be put into words here and where its sound goes: said beside the microphone before the first one is sent. */
  const [voice, setVoice] = useState<{ available: boolean; model?: string; host?: string; reads?: boolean; maxBytes: number; maxRequestBytes: number } | undefined>();
  useEffect(() => {
    let live = true;
    api.chatVoice(project.id).then((info) => live && setVoice(info), () => undefined);
    return () => {
      live = false;
    };
  }, [project.id]);
  const [deskOpen, setDeskOpen] = useState(false);
  const [deskPin, setDeskPin] = useState<string | null>(null);
  const [sourceFocus, setSourceFocus] = useState<SourceFocus | null>(null);
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

  /*
   * A stage pressed on the track. The page on screen stays while it shows at
   * that stage. A function that does not show there gives way to its
   * department's Summary, and a department with nothing there to Overview.
   *
   * The address is given the stage's word even when it is the project's own.
   * Without it, pressing the project's own stage would look like any link
   * that names none, and the stage left behind would be carried onto it. The
   * word for the project's own stage is dropped again once it has been read.
   */
  const pickStage = useCallback(
    (next: StageKey) => {
      if (next === stage) return;
      setFocusMode(false);
      setDeskOpen(false);
      setMobileSurface('work');
      const to = placeAtStage(project, place, next);
      const stays = to.department === place.department && to.fn === place.fn;
      const search = new URLSearchParams(stays ? location.search : '');
      search.set('stage', STAGE_WORD[next]);
      navigate({
        pathname: stays ? location.pathname : cockpitPath(project.id, to.department ? 'department' : 'overview', { department: to.department }),
        search: `?${search}`,
        hash: stays ? location.hash : '',
      });
    },
    [navigate, project, place, stage, location.pathname, location.search, location.hash],
  );

  /*
   * A link in an answer: a record's chip, a citation, a stage or a function
   * named by its id. It opens where the record lives: on the page of the
   * function that holds it, at the part of the page it sits in, or in the
   * register the whole project shares when no function's page has a place for
   * it. A check is docked in the chat as well, so it can be answered from
   * there. What the menu has no place for (a parcel, a party, a deed in the
   * chain) is looked at in the graph.
   */
  const openCited = useCallback(
    (id: string) => {
      const talk = sittingWithField(project, sittingFromCitedId(project, id));
      if (talk && (talk.kind === 'check' || talk.kind === 'scope')) setDockTalk(talk);
      const at = placeOfRecord(project, id, here);
      if (at?.kind === 'stage' && at.stage) {
        // A stage is looked at from where the person is, as when the track is pressed: the check or the document open stays open.
        pickStage(at.stage);
        return;
      }
      if (at) {
        setHighlightIds((prev) => [...new Set([...prev, id, ...(talk?.highlightIds ?? [])])]);
        goPane(at.open.pane, at.open.extra);
        return;
      }
      if (talk) {
        setHighlightIds((prev) => [...new Set([...prev, ...talk.highlightIds])]);
        goPane(paneForTalk(talk.kind), talk.extra);
        return;
      }
      goPane('graph', { node: id });
    },
    [project, goPane, here, pickStage],
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
      const lookAt = STAGES.find((s) => s.key === lastNav?.stage)?.key;
      if (target && lookAt && target === pane && !lastNav?.department && !lastNav?.workstream && !namedId && !lastNav?.evidenceId) {
        // Another stage asked for, on a page the whole project shares: the address stays as it is, a check or a
        // document open in it included, and only the stage changes, as it does when the track is pressed.
        pickStage(lookAt);
      } else if (target) {
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
    [setProject, navigate, toast, pane, pickStage],
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
   *
   * "New chat" starts another sitting without leaving the project, and
   * "Continue this chat" starts one that carries on an earlier chat: its
   * turns are kept with the old chat's and the two read as one. Either is a
   * fresh sitting, so a sitting is still one stretch of work.
   */
  const [held, setHeld] = useState<Sitting>(() => mintSitting(project.id));
  let sittingNow = held;
  if (held.project !== project.id) {
    // Another project on screen: its sitting starts in the render that shows it, so no question is asked under the last one's.
    sittingNow = mintSitting(project.id);
    setHeld(sittingNow);
  }
  const { id: sessionId, startedAt: sessionStartedAt, continues } = sittingNow;
  // How this person's own turns are signed. A note the server wrote for a colleague's upload is theirs, not this chat's.
  const myActor = me ? actorOf(me) : undefined;
  const startChat = useCallback((carryOn?: string) => setHeld(mintSitting(project.id, carryOn)), [project.id]);

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
    // The chat on screen is this sitting and the earlier chat it carries on. What that chat left waiting is not "from earlier".
    const turns = project.conversation ?? [];
    const onScreen = liveTurns(turns, chatSessions(turns), { sessionId, startedAt: sessionStartedAt, continues, actor: myActor });
    const earlier = waitingElsewhere(waiting.entries, onScreen);
    const count = earlier.reduce((n, e) => n + e.count, 0);
    if (!count) return undefined;
    return {
      id: 'waiting-from-earlier',
      role: 'assistant',
      text: `${count === 1 ? 'One thing is' : `${count} things are`} still waiting for you from earlier.`,
      at: sessionStartedAt,
      citedEvidenceIds: earlier.map((e) => e.evidenceId).filter((id): id is string => Boolean(id)),
      proposalIds: earlier.map((e) => e.proposalId).filter((id): id is string => Boolean(id)),
      // It lists what waits and filed none of it. The chips under it count the papers it names by this.
      toolCalls: [{ name: WAITING_FROM_EARLIER, summary: '' }],
    } as unknown as CopilotTurn;
  }, [project.conversation, waiting, sessionId, sessionStartedAt, continues, myActor]);
  const handleAsk = useCallback(
    async (
      question: string,
      files?: File[],
      /**
       * The record a picked choice pinned. Overrides the URL's sitting,
       * which is only where the person happens to be standing — when they
       * click "Physical boundaries…" the answer must be that check, not the
       * one the address bar still points at. A choice about a document pins
       * the document.
       */
      pinned?: ChoicePin,
    ) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setAsking(true);
      setChatSteps([]);
      setMobileSurface('chat');
      // A choice that accepts or sets aside pins the cards and papers it means, one under a plan pins the plan, and Undo pins the reply it undoes. They go with it whole.
      const sitting = pinned?.checkId || pinned?.evidenceId || pinned?.decision || pinned?.plan || pinned?.undo
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
        // A paper saved while the rest are still being read: its row is on the file now, so it is on the page now.
        if (event.event === 'filed' && event.row) {
          const row = event.row;
          const was = projectRef.current;
          const next = { ...was, evidence: was.evidence.some((e) => e.id === row.id) ? was.evidence.map((e) => (e.id === row.id ? row : e)) : [...was.evidence, row] };
          // Two papers can land before the page is drawn again: the second is laid over what the first left.
          projectRef.current = next;
          setProject(next);
        }
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
        // A photograph too large for one request is made smaller first, and a recording's length is measured: see `site-capture`.
        // Only where the server has said both sizes: one that has not been deployed yet says neither, and nothing is refused on a guess.
        const limits = voice && Number.isFinite(voice.maxBytes) && Number.isFinite(voice.maxRequestBytes) ? { maxFileBytes: voice.maxBytes, maxRequestBytes: voice.maxRequestBytes } : undefined;
        const ready = await readyToSend(files ?? [], limits ?? { maxFileBytes: LARGE_FILE_BYTES, maxRequestBytes: LARGE_FILE_BYTES });
        // Said before anything is sent, and the files stay with the person: one message here has a size.
        mustFitOneMessage(ready.files, limits, LARGE_FILE_BYTES);
        // A picture made smaller is said to be, as it goes: the smaller copy is the one that will be kept.
        if (ready.shrunk) {
          const to = Math.min(...ready.captured.flatMap((c) => (c.shrunkTo ? [c.shrunkTo] : [])));
          onStep({ id: `smaller-${Date.now()}`, at: new Date().toISOString(), kind: 'tool_result', label: `${ready.shrunk === 1 ? 'One picture was' : `${ready.shrunk} pictures were`} made smaller to send (${to.toLocaleString('en-IN')} pixels on the long side)` });
        }
        const big = ready.files.filter((f) => f.size >= LARGE_FILE_BYTES);
        const small = ready.files.filter((f) => f.size < LARGE_FILE_BYTES);
        const captured = ready.files.flatMap((f, n) => (f.size < LARGE_FILE_BYTES ? [ready.captured[n] ?? {}] : []));
        for (const [n, file] of big.entries()) {
          setLiveLabel(`Filing ${file.name} in parts (${n + 1} of ${big.length})…`);
          await uploadLargeDocument(project.id, file, { onProgress: (share) => setLiveLabel(`Filing ${file.name}: ${Math.round(share * 100)}%`) });
        }
        if (big.length) setLiveLabel(null);
        const ask = question.trim() || (big.length && !small.length ? 'Read the filed documents' : question);
        // `viewContext` stays for a server that reads only the pane; `place` says the department, the function and the stage.
        const response = small.length
          ? await api.projectChatFiles(project.id, { question: ask, viewContext: pane, place: here, files: small, captured, sitting, sessionId, continues, sessionStartedAt }, { onStep, onReading, signal: ac.signal })
          : await api.projectChat(project.id, { question: ask, viewContext: pane, place: here, sitting, sessionId, continues, sessionStartedAt }, { onStep, onReading, signal: ac.signal });
        // The id these turns were kept under is the sitting's from here on, so what was just said stays on screen.
        setHeld((was) => sittingKept(was, response));
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
    [project.id, pane, here, params.ddId, params.scopeId, searchParams, applyResult, setProject, sessionId, continues, sessionStartedAt, voice],
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
        /*
         * Documents are reviewed a function at a time: the desk opens on the
         * papers of the function this one belongs to, and its own "next"
         * walks on to the function after. Behind the desk the page is that
         * function's, at its documents, so closing the review leaves the
         * person where the papers live and not in the register of all of them.
         */
        const documents = waiting.entries.filter((e) => e.kind === 'facts' && e.evidenceId && e.fn === next.fn).map((e) => e.evidenceId!);
        const at = next.fn ? placeOfRecord(project, next.evidenceId, here) : undefined;
        if (at) goPane(at.open.pane, { ...at.open.extra, evidenceId: undefined });
        openReview(documents, next.evidenceId);
        return;
      }
      goPane(next.pane, next.extra);
      setLandOn({ kind: next.pane === 'scope' ? 'check' : 'pane', at: Date.now() });
    },
    [waiting, openReview, goPane, project, here],
  );

  /*
   * A chip under a reply. One that names a page opens it: a function's checks
   * with the values waiting on them, the documents a drop filed somewhere
   * else, a paper in the graph. One that names none walks what waits, as the
   * review always has.
   */
  const goChip = useCallback(
    (chip: TurnChip) => {
      if (chip.open) {
        const lit = chip.ids ?? [];
        if (lit.length) setHighlightIds((prev) => [...new Set([...prev, ...lit])]);
        goPane(chip.open.pane, chip.open.extra);
      } else if (chip.entry) {
        goWaiting(chip.entry);
      }
    },
    [goPane, goWaiting],
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

  /*
   * A question carried in an address (`?ask=`) waits in the message box, for
   * the person to read and send. The parameter is dropped once the words are
   * in the box, so a reload does not put them there again.
   */
  const [, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState<{ text: string } | null>(null);
  useEffect(() => {
    const carried = carriedQuestion(searchParams);
    if (!carried) return;
    setDraft({ text: carried.text });
    setMobileSurface('chat');
    setSearchParams(carried.rest, { replace: true });
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
  // The records an answer can name, and the frame they sit in: a stage, a
  // department or a function the copilot quoted by its graph id reads as its
  // name, and one the frame no longer has is left out of the sentence.
  const nodeLabels = useMemo(() => chatLinkLabels(project), [project]);

  /*
   * What to offer, from where the person is.
   *
   * A function's page, a department's Summary and each shared place has its
   * own few questions, kept in one table beside the engine that answers them;
   * anywhere else the questions follow from where the file stands. Nothing
   * waiting is offered here: it is decided on the canvas, and these are things
   * to ask.
   */
  const suggestions = useMemo(() => chatPrompts(project, here), [project, here]);

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
    stage,
    onOpenFromStage: openFromStage,
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
      sessionActor={myActor}
      continues={continues}
      place={here}
      draft={draft}
      onDraftTaken={() => setDraft(null)}
      onNewChat={() => startChat()}
      onContinueChat={(id) => startChat(id)}
      onRenameChat={async (id, name) => setProject((await api.renameChat(project.id, id, name)).project)}
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
      // A plan that moved while this page only watched it: the thread is read again. A read that fails leaves the page as it is.
      plans={{ projectId: project.id, onChanged: () => void api.getProject(project.id).then(setProject, () => undefined) }}
      screenResult={project.lastScreenResult}
      askingPrice={project.budget ?? null}
      onCancel={asking ? () => abortRef.current?.abort() : undefined}
      disabled={false}
      allowAttach
      voice={voice}
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
      placeholder={`Ask about ${chatPlaceLabel(here)}…`}
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
            <TurnWaiting project={project} turn={turn} waiting={waiting} here={here} onGo={goChip} />
          </>
        );
      }}
      onOpenNode={openCited}
      onOpenDocument={openCited}
      onOpenEvidence={openCited}
      onDeleteChats={
        conversation.length > 0 && mayDeleteChats(me?.role)
          ? async () => {
              await api.clearProjectChat(project.id);
              // The chat this sitting carried on went with the thread. What is said next starts one of its own.
              startChat();
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
      // The walk goes a function at a time, so the way on names the function whose documents are next.
      label: after.kind === 'facts' ? (after.fn ? `Next: ${chatPlaceLabel({ fn: after.fn })} documents` : `Next document: ${after.title}`) : after.pane === 'scope' ? 'Values on the checks' : `Next: ${paneLabel(after.pane)}`,
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
    </>
  );

  /*
   * A project's own controls, in the app's one top bar.
   *
   * This was a second bar under the first: the way back, the selector, the
   * stages, a count of things to review, the health of the file, alerts, a
   * command field and the focus switch, eight controls in five different
   * dresses. It is now the two things that say where and when (the selector,
   * the stage track) and three quiet icons. The way back is the sidebar's
   * Portfolio; the health of the file is the first thing on Overview; what
   * waits for review is a dot on the selector and the first row under the
   * bell.
   */
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setBarSlot(isDesktop ? document.getElementById(PROJECT_BAR_SLOT) : null);
  }, [isDesktop]);

  const bell = (
    <AlertsBell
      project={project}
      onChanged={setProject}
      onOpenWorkstream={(key) => goPane(WORKSTREAM_PANE[key] ?? 'workstream', { workstream: key })}
      review={{ count: waiting.total, onGo: () => goWaiting() }}
    />
  );

  const ICON_BUTTON = 'grid size-8 shrink-0 place-items-center rounded-lg text-ink-secondary transition-colors duration-quick hover:bg-sunken hover:text-ink';

  const projectBar = (
    <>
      <ProjectPicker pane={pane} project={project} stage={stage} department={params.department} workstream={params.workstream} onGo={goPane} waiting={waiting} />
      <StageTimeline project={project} stage={stage} onStage={pickStage} />
      {bell}
      <button type="button" onClick={() => setCommandOpen(true)} aria-label="Run a command" title="Command (⌘K)" className={ICON_BUTTON}>
        <Search size={16} />
      </button>
      <button
        type="button"
        onClick={() => setFocusMode((v) => !v)}
        aria-pressed={focusMode}
        aria-label={focusMode ? 'Leave focus' : 'Focus the conversation'}
        title={focusMode ? 'Leave focus (⌘.)' : 'Focus the conversation (⌘.)'}
        className={cn(ICON_BUTTON, focusMode && 'bg-ink text-[var(--text-inverse)] hover:bg-ink hover:text-[var(--text-inverse)]')}
      >
        {focusMode ? <PanelRight size={16} /> : <Maximize2 size={16} />}
      </button>
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
        barSlot ? createPortal(projectBar, barSlot) : null
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
            <ProjectPicker pane={pane} project={project} stage={stage} department={params.department} workstream={params.workstream} onGo={goPane} waiting={waiting} dense />
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
          <StagePill project={project} stage={stage} onStage={pickStage} onChanged={setProject} onOpen={openFromStage} />
          {bell}
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
                    stage={stage}
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
                  stage={stage}
                  ddId={params.ddId}
                  scopeId={params.scopeId}
                  department={params.department}
                  workstream={params.workstream}
                  overdue={overdue}
                  pendingDrafts={pendingDrafts}
                  onGo={goPane}
                  waiting={waiting}
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
