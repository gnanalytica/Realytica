import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, FileText, Loader2, ScanLine, Sparkles, X } from 'lucide-react';
import type { ChatProposal, DocumentFact } from '@realytica/shared';
import { cardStateFor, type ReadingFile, type ReadingSession, type SourceFocus } from '../../lib/reading';
import { cn } from '../ui/kit';
import { FactRow, type FactState } from './FactRow';
import { PagePreview } from './PagePreview';

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
 * one burst and nobody sees a page being read. Each file is shown in the
 * order it was read, for long enough to watch, and its facts come off the
 * page when both it has really been read and its turn has run. Nothing is
 * shown before it was read; things read quickly are only shown a little
 * later.
 */
function usePace(session: ReadingSession): { paces: Map<string, Pace>; now: number } {
  const seen = useRef(new Map<string, { started: number; read?: number }>());
  const [now, setNow] = useState(() => Date.now());

  for (const f of session.files) {
    const entry = seen.current.get(f.key) ?? { started: Date.now() };
    if (f.phase !== 'reading' && entry.read === undefined) entry.read = f.readAt ?? Date.now();
    seen.current.set(f.key, entry);
  }

  const paces = new Map<string, Pace>();
  let previousEnd = 0;
  for (const f of session.files) {
    const entry = seen.current.get(f.key)!;
    // A desk opened over cards already read has nothing to replay.
    if (session.mode === 'review') {
      paces.set(f.key, { showFrom: 0, showFacts: 0 });
      continue;
    }
    const showFrom = Math.max(entry.started, previousEnd);
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
 * The canvas while documents are read: the page being scanned, and what it
 * states coming off it.
 *
 * The chat says what happened and holds the cards to approve. This is where
 * it is seen — the scan going down the real page, each fact typed in as it is
 * read, and its words marked on the page when a person points at it, here or
 * on the card in the chat. When a card is approved its facts turn from ochre,
 * proposed, to green, filed.
 */
export function ReadingDesk({
  projectId,
  session,
  proposals,
  focus,
  pinKey,
  onFocus,
  onClose,
  onSettled,
}: {
  projectId: string;
  session: ReadingSession;
  proposals: ChatProposal[] | undefined;
  focus: SourceFocus | null;
  /** A document asked for by name — "show it on the page" on its card. */
  pinKey?: string | null;
  onFocus: (focus: SourceFocus | null) => void;
  onClose: () => void;
  /** Every file's card has been decided — the desk can hand back to the registers. */
  onSettled?: () => void;
}) {
  const { paces, now } = usePace(session);
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
    session.filing ? session.files.filter((f) => f.facts.length + f.modelFacts.length > 0).map((f) => f.key) : [],
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
    ?? [...visible].reverse().find((f) => !factsShown(f))
    ?? visible[visible.length - 1]
    ?? session.files[0];

  const readCount = session.files.filter((f) => factsShown(f) && f.phase !== 'reading').length;
  const factTotal = session.files.reduce((n, f) => n + (factsShown(f) ? f.facts.length + f.modelFacts.length : 0), 0);
  const allShown = session.finished && session.files.every((f) => factsShown(f));
  const decided = session.files.length > 0 && session.files.every((f) => states.get(f.key) !== 'proposed' || f.phase === 'failed');
  const anyFiled = session.files.some((f) => states.get(f.key) === 'filed');

  /* Once every card is decided and something was filed, hand the canvas back to the registers. */
  useEffect(() => {
    if (!allShown || !decided || !anyFiled || !onSettled || filingQueue.length) return;
    const t = window.setTimeout(onSettled, 2200);
    return () => window.clearTimeout(t);
  }, [allShown, decided, anyFiled, onSettled, filingQueue.length]);

  if (!current) return null;

  const shown = factsShown(current);
  const scanning = !shown && current.phase !== 'failed';
  const facts = shown ? [...current.facts, ...current.modelFacts] : [];
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
  const revealing = session.mode === 'live' && shown && now - (paces.get(current.key)?.showFacts ?? 0) < 4000;

  return (
    <div className="flex min-h-0 flex-1 flex-col animate-fade-in" aria-label="Reading the documents">
      <div className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2.5">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-brand/10 text-brand">
          <ScanLine size={15} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink">
            {session.mode === 'review'
              ? `${session.files.length === 1 ? 'The document' : `${session.files.length} documents`} and what they state`
              : session.finished && allShown
                ? `Read ${session.files.length === 1 ? 'the document' : `${session.files.length} documents`}`
                : `Reading ${session.files.length === 1 ? 'the document' : `${session.files.length} documents`}`}
          </p>
          <p className="text-micro text-ink-muted" aria-live="polite">
            {readCount} of {session.files.length} read · {factTotal} fact{factTotal === 1 ? '' : 's'}
            {decided && anyFiled ? ' · filed' : allShown ? ' · approve in the chat to file them' : ''}
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
                ) : s === 'filed' ? (
                  <Check size={12} className="text-[var(--status-good-text)]" aria-hidden />
                ) : done ? (
                  <Sparkles size={12} className="text-provenance-ink" aria-hidden />
                ) : (
                  <Loader2 size={12} className="animate-spin text-brand" aria-hidden />
                )}
                {shortName(f.fileName)}
                {done && f.facts.length + f.modelFacts.length ? (
                  <span className="font-mono text-micro text-ink-muted">{f.facts.length + f.modelFacts.length}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Rows sized to what is in them: stretched rows let a column's content spill over the next. */}
      <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fit,minmax(300px,1fr))] content-start gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-mono text-micro uppercase tracking-[0.08em] text-ink-muted">
              {(current.label ?? shortName(current.fileName)).toUpperCase()} · page {page}
              {current.pages ? ` of ${current.pages}` : ''}
            </p>
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
            className="max-h-[calc(100dvh-260px)] min-h-[320px]"
          />
          {pointed ? (
            <p className="animate-fade-in rounded-lg bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink-secondary ring-1 ring-inset ring-[var(--ring)]">
              <span className="mr-1.5 font-mono text-micro uppercase tracking-[0.08em] text-ink-muted">p.{pointed.page}</span>
              <QuoteWithValue fact={pointed} />
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-[12px] font-semibold text-ink">
            {scanning ? 'Reading…' : facts.length ? `What it states · ${facts.length}` : current.phase === 'failed' ? 'Could not be read' : 'Nothing stated that the reader knows'}
          </p>
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
          {facts.length ? (
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
          {shown && !facts.length && !current.notes && current.phase !== 'failed' && current.phase !== 'model' ? (
            <p className="flex items-center gap-1.5 text-[13px] text-ink-muted">
              <FileText size={13} aria-hidden />
              {current.summary ?? 'Filed as it is; nothing on it matched what the reader knows how to read.'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
