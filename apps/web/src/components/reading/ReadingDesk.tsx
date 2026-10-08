import { startTransition, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, ClipboardList, Clock, FileText, Loader2, ScanLine, Sparkles, X } from 'lucide-react';
import { proposedFacts, type DdProject, type DocumentFact, type EvidenceRecord } from '@realytica/shared';
import { api } from '../../lib/api';
import { cardStateFor, type ReadingFile, type ReadingSession, type SourceFocus } from '../../lib/reading';
import { Button, cn, useToast } from '../ui/kit';
import { FactRow, type FactState } from './FactRow';
import { FactReviewList, type FactDecision, type FactEdit } from './FactReview';
import { PagePreview } from './PagePreview';
import { nothingRead } from './said';

/** The register row a file on the desk was filed as — found by the stored file, which is all the reading knows. */
export function rowForFile(project: DdProject, key: string): EvidenceRecord | undefined {
  return project.evidence.find((e) => e.attachments.some((a) => a.storageKey === key));
}

/**
 * How long a document is shown being scanned, at the least — a text layer
 * reads in milliseconds. A little longer for more pages, which are stepped
 * through, and never so long that a stack of documents becomes a wait.
 */
function scanMs(pages: number | undefined): number {
  return Math.min(2800, Math.max(1400, (pages ?? 1) * 700));
}

/** The pages a replayed scan steps through: the first few, not every page of a long file. */
function replayPages(pages: number | undefined): number {
  return Math.max(1, Math.min(pages ?? 1, 4));
}

interface Pace {
  /** When the file is shown starting, and when its facts are shown. */
  showFrom: number;
  showFacts: number;
}

/**
 * The reading, paced to be watched.
 *
 * A text-layer deed is read in a few milliseconds, so nine of them arrive as
 * one burst and nobody sees a page being read. A file read by itself is shown
 * for long enough to watch, and its facts come off the page when both it has
 * really been read and its time has run. Nothing is shown before it was read;
 * things read quickly are only shown a little later.
 *
 * Papers dropped together are read three at a time and are all named from
 * the start, in the order dropped. Each is then paced by itself, from when
 * its own reading began: one that takes minutes does not hold back the two
 * read beside it.
 */
function usePace(session: ReadingSession): { paces: Map<string, Pace>; now: number } {
  const seen = useRef(new Map<string, { started?: number; read?: number }>());
  const [now, setNow] = useState(() => Date.now());

  for (const f of session.files) {
    const entry = seen.current.get(f.key) ?? {};
    if (f.phase !== 'queued' && entry.started === undefined) entry.started = Date.now();
    if (f.phase !== 'reading' && f.phase !== 'queued' && entry.read === undefined) entry.read = f.readAt ?? Date.now();
    seen.current.set(f.key, entry);
  }

  const paces = new Map<string, Pace>();
  /** Named before any was read: a drop of several, read side by side. */
  const together = Boolean(session.together);
  let previousEnd = 0;
  for (const f of session.files) {
    const entry = seen.current.get(f.key)!;
    if (together && session.mode !== 'review') {
      const showFacts = entry.started === undefined || entry.read === undefined ? Number.POSITIVE_INFINITY : Math.max(entry.read, entry.started + scanMs(f.pages));
      paces.set(f.key, { showFrom: 0, showFacts });
      continue;
    }
    // A desk opened over cards already read has nothing to replay.
    if (session.mode === 'review') {
      paces.set(f.key, { showFrom: 0, showFacts: 0 });
      continue;
    }
    const showFrom = Math.max(entry.started ?? Date.now(), previousEnd);
    const showFacts = entry.read === undefined ? Number.POSITIVE_INFINITY : Math.max(entry.read, showFrom + scanMs(f.pages));
    paces.set(f.key, { showFrom, showFacts });
    previousEnd = Number.isFinite(showFacts) ? showFacts + 250 : Number.POSITIVE_INFINITY;
  }

  const waiting = [...paces.values()].some((p) => p.showFacts > now || p.showFrom > now);
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => setNow(Date.now()), 120);
    return () => window.clearInterval(t);
  }, [waiting]);

  return { paces, now };
}

/** Where a department's questions are answered: the technical due diligence's own step for Engineering, the department's page for the rest. */
function questionsPath(projectId: string, department: string | undefined): string {
  return !department || department === 'construction' ? `/projects/${projectId}/w/construction.quality?step=questions` : `/projects/${projectId}/d/${department}?step=questions`;
}

/** Whether a file on the desk is sound: a voice note, which has no page to show. */
function isSoundFile(file: ReadingFile): boolean {
  return file.mimeType.startsWith('audio/') || file.taken?.as === 'voice';
}

/** "Sale deed" reads as "the sale deed"; "DC conversion order" keeps its acronym. */
function asNamed(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

function shortName(name: string): string {
  const bare = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
  return bare.length > 26 ? `${bare.slice(0, 25)}…` : bare;
}

/** A quote with the value inside it marked — the page's words, for a fact that cannot be placed on a page. */
function QuoteWithValue({ fact }: { fact: DocumentFact }) {
  const q = fact.quote;
  const forms = [fact.originalValue, String(fact.value), fact.display].filter((s): s is string => Boolean(s && s.length > 1));
  const lower = q.toLowerCase();
  const hit = forms.map((f) => ({ f, at: lower.indexOf(f.toLowerCase()) })).find((h) => h.at >= 0);
  if (!hit) return <>“{q}”</>;
  return (
    <>
      “{q.slice(0, hit.at)}
      <mark className="rounded-[2px] bg-mark/45 px-0.5 text-ink">{q.slice(hit.at, hit.at + hit.f.length)}</mark>
      {q.slice(hit.at + hit.f.length)}”
    </>
  );
}

/**
 * The canvas while documents are read, and where what they state is decided.
 *
 * The scan goes down the real page and each fact types in as it is read.
 * Once the documents are filed — which the upload does itself — each value
 * waits on its document, ochre, with the two decisions beside it: accept it
 * onto the file, or set it aside. Pointing at a value marks its words on the
 * page. The chat only talks; nothing here is approved there.
 */
export function ReadingDesk({
  project,
  session,
  focus,
  pinKey,
  onFocus,
  onClose,
  onDecided,
  next,
}: {
  project: DdProject;
  session: ReadingSession;
  focus: SourceFocus | null;
  /** A document asked for by name — "review" on its row. */
  pinKey?: string | null;
  onFocus: (focus: SourceFocus | null) => void;
  onClose: () => void;
  /** A value was decided; this is the project as it now stands. */
  onDecided: (project: DdProject) => void;
  /** Where the review goes once these documents are settled, if anything else waits. */
  next?: { label: string; onGo: () => void } | null;
}) {
  const projectId = project.id;
  const proposals = project.chatProposals;
  const toast = useToast();
  const { paces, now } = usePace(session);
  /*
   * Side by side when there is room, stacked when there is not — measured on
   * the desk, which is whatever the conversation leaves of the window. At
   * 1040px that is under 500px, and a page above a list put every value
   * below the fold of a page that scrolled on its own.
   */
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (!bodyEl) return;
    const ro = new ResizeObserver(([entry]) => setWide((entry?.contentRect.width ?? 0) >= 620));
    ro.observe(bodyEl);
    return () => ro.disconnect();
  }, [bodyEl]);
  const revealUntil = useRef(new Map<string, number>());
  /*
   * How large the page is drawn: 1 fits it to its half of the desk, which
   * beside a conversation leaves a deed's print a few pixels high. Kept from
   * one document to the next, since the print is as small on the next one.
   */
  const [zoom, setZoom] = useState(1);
  const [pinned, setPinned] = useState<string | null>(pinKey ?? null);
  useEffect(() => {
    if (pinKey) setPinned(pinKey);
  }, [pinKey]);

  const visible = session.files.filter((f) => (paces.get(f.key)?.showFrom ?? 0) <= now);
  const factsShown = (f: ReadingFile) => (paces.get(f.key)?.showFacts ?? 0) <= now;

  const states = useMemo(() => {
    const m = new Map<string, FactState>();
    for (const f of session.files) {
      const s = cardStateFor(f.key, proposals);
      m.set(f.key, s === 'committed' ? 'filed' : s === 'rejected' ? 'skipped' : 'proposed');
    }
    return m;
  }, [session.files, proposals]);

  /*
   * Filing, shown file by file.
   *
   * One approval turns its document's facts green where it stands. Several
   * at once — "approve all" — step through the documents a second each, so
   * the filing is seen rather than reported, and only then does the desk
   * hand back to the register.
   */
  const lastStates = useRef<Map<string, FactState> | null>(null);
  const [filingQueue, setFilingQueue] = useState<string[]>(() =>
    (session.filingKeys ?? []).filter((key) => session.files.some((f) => f.key === key && f.facts.length + f.modelFacts.length > 0)),
  );
  useEffect(() => {
    const before = lastStates.current;
    lastStates.current = new Map(states);
    if (!before) return;
    const newly = session.files.filter((f) => states.get(f.key) === 'filed' && before.get(f.key) === 'proposed').map((f) => f.key);
    if (newly.length > 1) setFilingQueue(newly);
    else if (newly.length === 1) setPinned(newly[0]!);
  }, [states, session.files]);
  useEffect(() => {
    const next = filingQueue[0];
    if (!next) return;
    setPinned(next);
    onFocus(null);
    const t = window.setTimeout(() => setFilingQueue((q) => q.slice(1)), 1100);
    return () => window.clearTimeout(t);
    // `onFocus` is the parent's setter; re-running for a new identity would restart the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filingQueue]);

  /* The file in front: the one being filed, else the one pointed at, else the one picked, else the one being read now. */
  const current =
    (filingQueue[0] && session.files.find((f) => f.key === filingQueue[0]))
    ?? (focus && session.files.find((f) => f.key === focus.key))
    ?? (pinned && session.files.find((f) => f.key === pinned))
    // Of several read side by side: the first, in the order dropped, that is being read; then the last one read.
    ?? visible.find((f) => f.phase !== 'queued' && !factsShown(f))
    ?? [...visible].reverse().find((f) => f.phase !== 'queued')
    ?? visible[visible.length - 1]
    ?? session.files[0];

  const readCount = session.files.filter((f) => factsShown(f) && f.phase !== 'reading').length;
  const allShown = session.finished && session.files.every((f) => factsShown(f));
  const rows = new Map(session.files.map((f) => [f.key, rowForFile(project, f.key)] as const));
  // Filed, a document states what its row holds; still being read, what the stream has found.
  const factTotal = session.files.reduce(
    (n, f) => n + (factsShown(f) ? (rows.get(f.key)?.facts?.length ?? f.facts.length + f.modelFacts.length) : 0),
    0,
  );
  const waitingOn = (f: ReadingFile) => proposedFacts(rows.get(f.key) ?? {}).length;
  const waitingTotal = session.files.reduce((n, f) => n + (factsShown(f) ? waitingOn(f) : 0), 0);
  const reviewed = session.files.some((f) => (rows.get(f.key)?.facts ?? []).length > 0);
  const settled = allShown && reviewed && waitingTotal === 0;

  /*
   * Decisions go to the server one at a time, in the order they were made:
   * two in flight at once could answer out of order and show the file as it
   * stood before the later one.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function decide(row: EvidenceRecord, keys: string[] | 'all', decision: FactDecision, edit?: FactEdit, take?: 'other'): Promise<boolean> {
    const run = queue.current.then(async () => {
      try {
        const { project: next } = await api.reviewFacts(projectId, row.id, { keys, decision, edit, ...(take ? { take } : {}) });
        onDecided(next);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : 'That value could not be decided', 'critical');
        return false;
      }
    });
    queue.current = run;
    return run;
  }

  if (!current) return null;

  const shown = factsShown(current);
  const scanning = !shown && current.phase !== 'failed';
  const facts = shown ? [...current.facts, ...current.modelFacts] : [];
  /* Filed: what the row holds, each value with where it stands. Before that, what the stream read. */
  const row = rows.get(current.key);
  const rowFacts = shown && row ? row.facts ?? [] : [];
  const pointed = focus && focus.key === current.key ? focus.fact : null;
  /*
   * The page in front while scanning. While the server is still reading, the
   * page it has reached. Once it has finished and the scan is being shown,
   * the first few pages in turn, each with its own pass of the line.
   */
  const pace = paces.get(current.key);
  const stillReading = current.phase === 'reading';
  const steps = replayPages(current.pages);
  const perPage = scanMs(current.pages) / steps;
  const replayPage = Math.min(steps, 1 + Math.floor(Math.max(0, now - (pace?.showFrom ?? now)) / perPage));
  const page = pointed?.page ?? (scanning ? (stillReading ? current.page ?? 1 : replayPage) : facts[0]?.page ?? 1);
  const scanDuration = stillReading ? undefined : perPage;
  const state = states.get(current.key) ?? 'proposed';
  /*
   * A document's facts type in once: the first time they are shown, for long
   * enough to finish. Coming back to it later shows them as they are. Timed
   * on the clock rather than on the pacing's `now`, which stops once there is
   * nothing left to pace — and kept every document typing in afresh.
   */
  if (session.mode === 'live' && shown && !revealUntil.current.has(current.key)) {
    revealUntil.current.set(current.key, Date.now() + 3600);
  }
  const revealing = (revealUntil.current.get(current.key) ?? 0) > Date.now();
  /*
   * A link on the desk leads to a page under it, so the desk goes when one is
   * pressed. In a transition, as the page arrives: closed outright it would
   * first uncover the page being left. A press that opens another tab leaves
   * the desk where it is.
   */
  const leave = (e: MouseEvent) => {
    if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) startTransition(onClose);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col animate-fade-in" aria-label="Reading the documents">
      <div className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2.5">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-brand/10 text-brand">
          <ScanLine size={15} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink">
            {session.mode === 'review'
              ? session.files.length === 1
                ? 'The document and what it states'
                : `${session.files.length} documents and what they state`
              : session.finished && allShown
                ? `Read ${session.files.length === 1 ? 'the document' : `${session.files.length} documents`}`
                : `Reading ${session.files.length === 1 ? 'the document' : `${session.files.length} documents`}`}
          </p>
          <p className="text-micro text-ink-muted" aria-live="polite">
            {readCount} of {session.files.length} read · {factTotal} fact{factTotal === 1 ? '' : 's'}
            {settled ? ' · all settled' : waitingTotal ? ` · ${waitingTotal} waiting for you` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the reading"
          className="rounded-lg p-1.5 text-ink-muted hover:bg-sunken hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      {session.files.length > 1 ? (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-hairline px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Documents">
          {visible.map((f) => {
            const done = factsShown(f);
            const s = states.get(f.key);
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={f.key === current.key}
                onClick={() => setPinned(f.key)}
                className={cn(
                  'flex shrink-0 animate-rise-in items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ring-1 ring-inset transition-colors duration-quick',
                  f.key === current.key ? 'bg-raised font-medium text-ink ring-brand/40' : 'text-ink-secondary ring-[var(--ring)] hover:text-ink',
                )}
              >
                {f.phase === 'failed' ? (
                  <AlertTriangle size={12} className="text-[var(--status-warning-text)]" aria-hidden />
                ) : f.phase === 'queued' ? (
                  // Named, and waiting its turn: three are read at a time.
                  <Clock size={12} className="text-ink-muted" aria-label="waiting to be read" />
                ) : done && waitingOn(f) > 0 ? (
                  // Filed, but what it states is still waiting: not done yet.
                  <Sparkles size={12} className="text-provenance-ink" aria-hidden />
                ) : s === 'filed' ? (
                  <Check size={12} className="text-[var(--status-good-text)]" aria-hidden />
                ) : done ? (
                  <Sparkles size={12} className="text-provenance-ink" aria-hidden />
                ) : (
                  <Loader2 size={12} className="animate-spin text-brand" aria-hidden />
                )}
                {shortName(f.fileName)}
                {done && rows.get(f.key) && (rows.get(f.key)!.facts ?? []).length ? (
                  waitingOn(f) ? (
                    <span className="rounded-full bg-provenance/15 px-1.5 font-mono text-micro text-provenance-ink">{waitingOn(f)}</span>
                  ) : (
                    <Check size={12} className="text-[var(--status-good-text)]" aria-label="settled" />
                  )
                ) : done && f.facts.length + f.modelFacts.length ? (
                  <span className="font-mono text-micro text-ink-muted">{f.facts.length + f.modelFacts.length}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* The page and what it states, each scrolling on its own so neither pushes the other off the screen. */}
      <div ref={setBodyEl} className={cn('flex min-h-0 flex-1', wide ? 'flex-row gap-4 p-4' : 'flex-col gap-3 p-3')}>
        <div className={cn('flex min-h-0 flex-col gap-2', wide ? 'min-w-0 flex-1' : 'h-[40%] min-h-[190px] shrink-0')}>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-mono text-micro uppercase tracking-[0.08em] text-ink-muted">
              {(current.label ?? shortName(current.fileName)).toUpperCase()}
              {/* Sound has no pages. */}
              {isSoundFile(current) ? '' : ` · page ${page}${current.pages ? ` of ${current.pages}` : ''}`}
            </p>
            {isSoundFile(current) ? null : (
              // The pop-up's three: smaller, the width it fits, larger.
              <span className="flex shrink-0 items-center">
                <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} className="rounded px-2 py-0.5 text-mini text-ink-secondary hover:text-ink disabled:text-ink-muted">
                  −
                </button>
                <button type="button" onClick={() => setZoom(1)} className="rounded px-2 py-0.5 text-mini text-ink-secondary hover:text-ink">
                  Fit
                </button>
                <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} disabled={zoom >= 4} className="rounded px-2 py-0.5 text-mini text-ink-secondary hover:text-ink disabled:text-ink-muted">
                  +
                </button>
              </span>
            )}
            {scanning ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-micro font-medium text-brand-ink">
                <Sparkles size={10} aria-hidden />
                Reading
              </span>
            ) : current.phase === 'model' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-provenance/15 px-2 py-0.5 text-micro font-medium text-provenance-ink">
                <Loader2 size={10} className="animate-spin" aria-hidden />
                Model reading
              </span>
            ) : null}
          </div>
          <PagePreview
            projectId={projectId}
            source={current.source}
            mimeType={current.mimeType}
            page={page}
            scanning={scanning}
            scanMs={scanDuration}
            marks={pointed?.marks ?? null}
            markId={pointed ? `${current.key}:${pointed.key}` : undefined}
            zoom={zoom}
            className="min-h-0 flex-1"
          />
          {pointed ? (
            <p
              className={cn(
                'shrink-0 animate-fade-in rounded-lg bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-secondary ring-1 ring-inset ring-[var(--ring)]',
                !wide && 'line-clamp-2',
              )}
            >
              <span className="mr-1.5 font-mono text-micro uppercase tracking-[0.08em] text-ink-muted">p.{pointed.page}</span>
              <QuoteWithValue fact={pointed} />
            </p>
          ) : null}
        </div>

        <div className={cn('flex min-h-0 flex-col gap-2 overflow-y-auto', wide ? 'w-[min(46%,440px)] shrink-0 pr-1' : 'flex-1')}>
          {rowFacts.length ? null : (
          <p className="text-[12px] font-semibold text-ink">
            {scanning ? 'Reading…' : current.taken ? { questionnaire: 'A questionnaire', notes: 'Notes of a meeting', voice: 'A voice note', photo: 'A site photograph' }[current.taken.as] : facts.length ? `What it states · ${facts.length}` : current.phase === 'failed' ? 'Could not be read' : 'Nothing stated that the reader knows'}
          </p>
          )}
          {scanning ? (
            <div className="flex flex-col gap-1.5" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="relative h-[54px] overflow-hidden rounded-lg bg-surface ring-1 ring-inset ring-[var(--ring)]">
                  <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-sunken to-transparent" />
                </div>
              ))}
            </div>
          ) : null}
          {current.phase === 'failed' && current.failure ? (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-ink">{current.failure}</p>
          ) : null}
          {rowFacts.length && row ? (
            <FactReviewList
              key={row.id}
              documentName={asNamed(row.documentType ?? current.label ?? 'document')}
              documentType={row.documentType}
              offered={Boolean(row.proposedDocumentType)}
              facts={rowFacts}
              busy={false}
              revealing={revealing}
              activeKey={pointed?.key ?? null}
              onPoint={(f) => onFocus(f ? { key: current.key, fact: f } : null)}
              onDecide={(keys, decision, edit, take) => decide(row, keys, decision, edit, take)}
            />
          ) : facts.length ? (
            <div className="flex flex-col gap-1.5" onMouseLeave={() => onFocus(null)}>
              {facts.map((fact, i) => (
                <FactRow
                  key={`${current.key}:${fact.key}`}
                  fact={fact}
                  index={i}
                  revealing={revealing}
                  state={state}
                  active={Boolean(pointed && pointed.key === fact.key)}
                  onPoint={(f) => onFocus(f ? { key: current.key, fact: f } : null)}
                />
              ))}
            </div>
          ) : null}
          {shown && current.phase === 'model' ? (
            <div className="relative h-[44px] overflow-hidden rounded-lg bg-provenance/5 ring-1 ring-inset ring-provenance/25">
              <p className="relative z-10 px-3 py-3 text-[12px] text-provenance-ink">The model is reading it as well…</p>
              <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-provenance/10 to-transparent" />
            </div>
          ) : null}
          {shown && current.notes ? (
            <div className="animate-fade-in rounded-lg border-l-2 border-provenance/60 bg-surface px-3 py-2 ring-1 ring-inset ring-[var(--ring)]">
              <p className="mb-0.5 flex items-center gap-1 text-micro font-medium uppercase tracking-[0.06em] text-provenance-ink">
                <Sparkles size={10} aria-hidden />
                The model's reading
              </p>
              <p className="text-[13px] leading-relaxed text-ink-secondary">{current.notes}</p>
            </div>
          ) : null}
          {current.taken ? (
            // No paper, and on no row: what became of it, and the way to it.
            <div className="flex flex-col items-start gap-2 rounded-lg bg-surface px-3 py-2.5 ring-1 ring-inset ring-[var(--ring)]">
              <p className="flex items-center gap-1.5 text-[13px] text-ink">
                <ClipboardList size={13} aria-hidden />
                {current.taken.said}.
              </p>
              {current.taken.as === 'questionnaire' ? (
                <Link
                  to={questionsPath(projectId, current.taken.department)}
                  onClick={leave}
                  className="inline-flex items-center gap-1 rounded-md bg-raised px-2.5 py-1 text-[12px] font-medium text-ink ring-1 ring-inset ring-[var(--ring)] hover:text-brand"
                >
                  Open the questions
                  <ArrowRight size={12} aria-hidden />
                </Link>
              ) : current.taken.as === 'photo' ? (
                <Link
                  to={`/projects/${projectId}/w/construction.progress`}
                  onClick={leave}
                  className="inline-flex items-center gap-1 rounded-md bg-raised px-2.5 py-1 text-[12px] font-medium text-ink ring-1 ring-inset ring-[var(--ring)] hover:text-brand"
                >
                  Open Progress
                  <ArrowRight size={12} aria-hidden />
                </Link>
              ) : (
                <p className="text-micro text-ink-muted">{current.taken.as === 'voice' ? 'What it proposes waits under “Needs your decision”.' : 'What it proposes is in the chat.'}</p>
              )}
            </div>
          ) : nothingRead({ shown, streamed: facts.length, held: rowFacts.length, notes: current.notes, phase: current.phase }) ? (
            // Only where nothing was read. A filed paper's values are its row's, listed above, and the stream's own list is empty beside them.
            <p className="flex items-center gap-1.5 text-[13px] text-ink-muted">
              <FileText size={13} aria-hidden />
              {current.summary ?? 'Filed as it is; nothing on it matched what the reader knows how to read.'}
            </p>
          ) : null}
        </div>
      </div>

      {/*
        Settled: say so, and say where the work goes next — the checks these
        values answer, usually — rather than leaving a finished desk to be
        closed by hand.
      */}
      {settled ? (
        <div className="flex shrink-0 animate-rise-in flex-wrap items-center gap-2 border-t border-hairline bg-surface px-4 py-2.5">
          <span className="flex size-6 items-center justify-center rounded-full bg-good/15 text-[var(--status-good-text)]">
            <Check size={13} strokeWidth={3} aria-hidden />
          </span>
          <p className="min-w-[12rem] flex-1 text-[13px] text-ink">
            {session.files.length === 1 ? 'Every value on this document is settled.' : 'Every value on these documents is settled.'}
          </p>
          {next ? (
            <Button size="sm" variant="primary" onClick={next.onGo}>
              {next.label}
              <ArrowRight size={13} aria-hidden />
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Back to documents
          </Button>
        </div>
      ) : null}
    </div>
  );
}
