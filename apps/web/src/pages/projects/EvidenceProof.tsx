import { Suspense, lazy, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileWarning } from 'lucide-react';
import { DOCUMENT_WORKSTREAM, factReview, proofSaid, readingLine, sentToModelLine, soundReading, type DdProject, type DocumentFact, type EvidenceAttachment, type EvidenceRecord, type FactMarks } from '@realytica/shared';
import { OtherReading } from '../../components/reading/FactRow';
import { pointsAt, type SeenAt } from '../../components/reading/pointed';
import { Button, cn, useToast } from '../../components/ui/kit';
import { api } from '../../lib/api';
import { DESKTOP_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { ImageView } from '../../components/viewer/ImageView';
import { fetchEvidenceFile, renderKindFor, saveEvidenceFile, type DocumentSourceState } from '../../components/viewer/source';

/*
 * Both readers are loaded only when a document of that kind is opened.
 *
 * They carry the two largest dependencies in the app — a PDF engine and a
 * .docx converter — and most sessions open neither. Paying for them before the
 * sign-in screen paints was the single biggest thing in the bundle.
 */
const PdfView = lazy(() => import('../../components/viewer/PdfView').then((m) => ({ default: m.PdfView })));
const DocxView = lazy(() => import('../../components/viewer/DocxView').then((m) => ({ default: m.DocxView })));

/** The part of a project page the work is drawn in. A paper opens over it and leaves the conversation beside it in reach. */
const WORK_SURFACE = 'section[aria-label="Work surface"]';

export function EvidenceProof({
  projectId,
  evidence,
  file,
  quotes,
  citedPage,
  highlightTerm,
  onClose,
  onProject,
}: {
  projectId: string;
  evidence: EvidenceRecord;
  file?: EvidenceAttachment;
  quotes?: Array<{ text: string; page?: number }>;
  citedPage?: number;
  highlightTerm?: string;
  onClose: () => void;
  /** The project as it stands after something here changed it: a type confirmed. */
  onProject?: (next: DdProject) => void;
}) {
  const [state, setState] = useState<DocumentSourceState>({ status: 'loading' });
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  /*
   * Fetched once for a file, by what names it. The project is a new object
   * after every change to it, this pop-up's own buttons included, and a fetch
   * that followed the object drew the page again each time one was pressed.
   */
  const fileId = file?.id;
  const fileName = file?.fileName;
  const mimeType = file?.mimeType;
  useEffect(() => {
    if (!fileId) {
      setState({ status: 'absent' });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    void fetchEvidenceFile(projectId, evidence.id, fileId, fileName, mimeType).then((next) => {
      if (cancelled) {
        if (next.status === 'ready') URL.revokeObjectURL(next.url);
        return;
      }
      if (next.status === 'ready') objectUrl = next.url;
      setState(next);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, evidence.id, fileId, fileName, mimeType]);

  /*
   * Where it is drawn. Beside the conversation it lies over the work alone,
   * so the answer that cited the paper stays in reach; on a phone, where only
   * one of the two is on screen, over everything. Never where it is declared:
   * a pane on its way in carries a transform, and a box with a transform is
   * what a fixed layer inside it is fixed to.
   */
  const anchor = useRef<HTMLSpanElement>(null);
  const twoUp = useMediaQuery(DESKTOP_QUERY);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost((twoUp ? anchor.current?.closest<HTMLElement>(WORK_SURFACE) : null) ?? document.body);
  }, [twoUp]);
  const overWork = host !== null && host !== document.body;

  const layer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  /*
   * What it covers is out of reach while it is open. The keyboard goes in on
   * open and back to where it was on close, as it does for any dialog here.
   * A person typing in the conversation beside it keeps their place.
   */
  useEffect(() => {
    const el = layer.current;
    if (!host || !el) return;
    const from = document.activeElement;
    const covered: Element[] = [];
    for (const child of [...host.children]) {
      if (child === el || child.hasAttribute('inert') || (child instanceof HTMLElement && child.dataset.layer)) continue;
      child.setAttribute('inert', '');
      covered.push(child);
    }
    const typing = from instanceof HTMLElement && from.matches('textarea, input, [contenteditable="true"]') && !from.closest('[inert]');
    if (!typing) (panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current)?.focus();
    return () => {
      for (const child of covered) child.removeAttribute('inert');
      const at = document.activeElement;
      if (from instanceof HTMLElement && from.isConnected && (!at || at === document.body || el.contains(at))) from.focus();
    };
  }, [host]);

  /*
   * Escape closes it wherever the keyboard is, the conversation's box included.
   * Anything open over it takes the key first. What stands over it is looked
   * at as the key goes down, before a menu that closes on the same key is gone.
   */
  useEffect(() => {
    let under = false;
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') under = openOver(panel.current);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || under) return;
      const dialog = e.target instanceof Element ? e.target.closest('[role="dialog"]') : null;
      if (dialog && dialog !== panel.current) return;
      onClose();
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  /*
   * A fact picked in the panel moves the viewer to its page and lights its
   * words. Until one is picked, the citation the caller opened with stands.
   */
  const [picked, setPicked] = useState<DocumentFact | null>(null);
  /*
   * Pointing at a fact shows it as picking it does, until another is pointed
   * at or the pointer leaves the list: between two rows the first stands, so
   * a slow hand does not send the paper to the cited page and back. A fact
   * drawn under a pointer at rest is not pointed at: the list can open under
   * the press that cited a page, and would turn the paper from it.
   */
  const [pointed, setPointed] = useState<DocumentFact | null>(null);
  const seenAt = useRef<SeenAt | null>(null);
  /*
   * A pick is of one paper. A link in the conversation beside this can open
   * another while it is open, and a fact of the first must not stay picked
   * there, with its marks laid over a page they were never found on.
   */
  const [paper, setPaper] = useState(evidence.id);
  if (paper !== evidence.id) {
    setPaper(evidence.id);
    setPicked(null);
    setPointed(null);
  }
  const shown = pointed ?? picked;
  const page = shown?.page ?? citedPage ?? quotes?.find((q) => q.page)?.page ?? evidence.quotes?.find((q) => q.page)?.page;
  // Where the reader placed the fact's words, the marks are the highlight; the text search is for the rest.
  const marks = shown?.marks?.quote.length ? { page: shown.page, id: `${evidence.id}:${shown.key}`, ...shown.marks } : undefined;
  // A Word file has no page to place marks on, so its words are always looked for.
  const words = shown?.quote ?? highlightTerm ?? quotes?.[0]?.text ?? evidence.quotes?.[0]?.text;
  const term = marks ? undefined : words;
  const shownQuotes = quotes?.length ? quotes : evidence.quotes;
  const facts = evidence.facts ?? [];
  // How much of this file was read, and what a model read on it that nothing stands behind. Only a reading that is sound is drawn.
  const reading = soundReading(file?.reading);
  const coverage = [readingLine(reading), sentToModelLine(reading)].filter(Boolean).join(' ');
  const unverified = reading?.unverified ?? [];
  const beside = facts.length > 0 || unverified.length > 0;
  const offered = evidence.proposedDocumentType;
  // The row's values are read from its latest file. Shown beside an earlier one, that is said.
  const readFrom = evidence.attachments[evidence.attachments.length - 1];
  const otherFile = file && readFrom && readFrom.id !== file.id && facts.length > 0 ? readFrom.fileName : undefined;
  /** One of the three things a person can say of the model's offer, then the project as it stands. */
  const decideType = (act: Promise<{ project: DdProject }>, failed: string) => {
    setConfirming(true);
    void act
      .then(({ project }) => onProject?.(project))
      .catch((e: unknown) => toast(e instanceof Error ? e.message : failed, 'critical'))
      .finally(() => setConfirming(false));
  };

  const popup = (
    <div
      ref={layer}
      data-layer={overWork ? undefined : 'modal'}
      // Its parts lie side by side or one above the other by the room this layer has, which over the work is not the window's.
      className={cn('inset-0 flex items-end justify-center p-3 [container-type:inline-size] sm:items-center sm:p-4', overWork ? 'absolute z-20' : 'fixed z-50')}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        // Over the work it is not the only thing in reach: the conversation is.
        aria-modal={overWork ? undefined : 'true'}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex w-full flex-col overflow-hidden rounded-xl bg-surface shadow-pop outline-none ring-1 ring-[var(--ring)]',
          // A height of its own, not one taken from what is in it: the viewer inside fills what it is given and scrolls there.
          overWork ? 'h-full' : 'h-[min(92dvh,56rem)]',
          beside ? 'max-w-6xl' : 'max-w-4xl',
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-[13px] font-semibold text-ink">{evidence.title}</h2>
            <p className="truncate text-[12px] text-ink-muted">
              {file?.fileName ?? 'No file on this row'}
              {evidence.documentType ? ` · read as ${evidence.documentType}` : ''}
              {evidence.readMethod === 'ocr' ? ' · from a scan' : ''}
            </p>
            {offered ? (
              <p className="text-[12px] text-provenance-ink">
                {/* A row with no kind is offered one only by a model. A row that has one keeps it whatever is read off a file put on it, so that offer may be the rules' own reading. */}
                {evidence.documentType ? 'A reading takes this for' : 'A model takes this for'} {/^[aeiou]/i.test(offered) ? 'an' : 'a'} {offered.toLowerCase()}. Nobody has confirmed that, so it answers no waiting row.
                {onProject ? (
                  <>
                    <button
                      type="button"
                      disabled={confirming}
                      onClick={() => decideType(api.confirmDocumentType(projectId, evidence.id), 'The type could not be confirmed')}
                      className="ml-1.5 font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      Confirm it is
                    </button>
                    <button
                      type="button"
                      disabled={confirming}
                      onClick={() => decideType(api.setAsideDocumentType(projectId, evidence.id), 'The offer could not be set aside')}
                      className="ml-2 font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      It is not
                    </button>
                    <select
                      aria-label="Say what this document is instead"
                      disabled={confirming}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) decideType(api.correctDocumentType(projectId, evidence.id, e.target.value), 'The type could not be set');
                      }}
                      className="ml-2 max-w-[11rem] rounded-md bg-surface px-1.5 py-0.5 text-[12px] text-ink ring-1 ring-inset ring-[var(--ring)] disabled:opacity-50"
                    >
                      <option value="">It is something else…</option>
                      {Object.keys(DOCUMENT_WORKSTREAM)
                        .filter((type) => type !== offered)
                        .map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                    </select>
                  </>
                ) : null}
              </p>
            ) : null}
            {coverage ? <p className="text-[12px] text-ink-muted">{coverage}</p> : null}
            {otherFile ? <p className="text-[12px] text-ink-muted">The values beside it were read from {otherFile}, the latest file on this row.</p> : null}
          </div>
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
            {file ? (
              <button
                type="button"
                onClick={() =>
                  void saveEvidenceFile(projectId, evidence.id, file.id, file.fileName).catch((e: unknown) =>
                    toast(e instanceof Error ? e.message : 'The file could not be downloaded', 'critical'),
                  )
                }
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-brand hover:bg-brand-soft"
              >
                <Download size={12} /> Download
              </button>
            ) : null}
            {/* The keyboard starts here: on nothing that changes the record. */}
            <Button size="sm" variant="ghost" data-autofocus onClick={onClose}>
              Close
            </Button>
          </div>
        </header>
        {!facts.length && shownQuotes?.length ? (
          <div className="shrink-0 space-y-1 border-b border-hairline bg-sunken px-4 py-2">
            {shownQuotes.slice(0, 4).map((q, i) => (
              <p key={i} className="text-[12px] leading-relaxed text-ink-secondary">
                “{q.text}”{q.page ? <span className="text-ink-muted"> · p.{q.page}</span> : null}
              </p>
            ))}
          </div>
        ) : null}
        <div className={cn('flex min-h-0 flex-1 flex-col', beside && '[@container(min-width:52rem)]:flex-row')}>
          <div className="min-h-[18rem] min-w-0 flex-1 overflow-hidden bg-sunken">
            <ProofBody state={state} fileName={file?.fileName ?? evidence.title} citedPage={page} highlightTerm={term} words={words} marks={marks} />
          </div>
          {beside ? (
            <aside
              aria-label="What this document states"
              className="max-h-[40dvh] shrink-0 overflow-y-auto border-t border-hairline [@container(min-width:52rem)]:max-h-none [@container(min-width:52rem)]:w-[22rem] [@container(min-width:52rem)]:border-l [@container(min-width:52rem)]:border-t-0"
            >
              <div className="sticky top-0 border-b border-hairline bg-surface px-4 py-2.5">
                <p className="text-[12px] font-semibold text-ink">What this document states</p>
                <p className="text-[11px] text-ink-muted">
                  {facts.length
                    ? `${facts.length} fact${facts.length === 1 ? '' : 's'}, each with its page and its own words. Pick one to see it.`
                    : 'Nothing was read from it that could be found on a page.'}
                </p>
              </div>
              <ul className="divide-y divide-hairline" onMouseLeave={() => setPointed(null)}>
                {facts.map((fact, i) => {
                  const on = picked?.key === fact.key;
                  // Where it stands: the viewer shows what the document says, not only what was accepted.
                  const review = factReview(fact);
                  return (
                    <li key={`${fact.key}:${i}`}>
                      <button
                        type="button"
                        onClick={() => {
                          // The fact still shown may be the row the pointer came from: a press says which row is meant.
                          if (pointed !== fact) setPointed(null);
                          setPicked(on ? null : fact);
                        }}
                        onMouseMove={(e) => {
                          seenAt.current ??= { x: e.clientX, y: e.clientY };
                          if (pointed !== fact && pointsAt(seenAt.current, e)) setPointed(fact);
                        }}
                        onMouseLeave={() => {
                          seenAt.current = null;
                        }}
                        onFocus={() => setPointed(fact)}
                        onBlur={() => setPointed(null)}
                        aria-pressed={on}
                        className={cn('block w-full px-4 py-2.5 text-left hover:bg-sunken', on && 'bg-brand-soft/60')}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] font-medium text-ink-secondary">{fact.label}</span>
                          <span className="shrink-0 font-mono text-[10px] text-ink-muted">
                            p.{fact.page}
                            {fact.source === 'model' ? ' · AI read' : ''}
                            {review === 'proposed' ? <span className="text-provenance-ink"> · waiting</span> : review === 'rejected' ? ' · set aside' : ''}
                          </span>
                        </span>
                        <span className={cn('mt-0.5 block text-[13px] font-medium', review === 'rejected' ? 'text-ink-muted line-through' : 'text-ink')}>
                          {fact.display}
                        </span>
                        {fact.originalValue ? (
                          <span
                            lang={fact.originalScript === 'kannada' ? 'kn' : fact.originalScript === 'telugu' ? 'te' : undefined}
                            className="mt-0.5 block text-[14px] text-ink [font-family:'Noto_Sans_Kannada','Noto_Sans_Telugu','Kannada_Sangam_MN','Telugu_Sangam_MN','Tunga',system-ui,sans-serif]"
                          >
                            {fact.originalValue}
                            <span className="ml-1.5 align-middle text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                              {fact.originalScript} original
                            </span>
                          </span>
                        ) : null}
                        <span className="mt-1 block text-[11px] leading-snug text-ink-muted">“{fact.quote}”</span>
                        {/* What stands behind a model's value: its words in the page's text, or copied off the page by a second reader. */}
                        {proofSaid(fact) ? <span className="mt-0.5 block text-[10px] text-ink-muted first-letter:uppercase">{proofSaid(fact)}</span> : null}
                        {fact.otherReading && review === 'proposed' ? <OtherReading fact={fact} /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {unverified.length ? (
                <div className="border-t border-hairline px-4 py-2.5">
                  <p className="text-[12px] font-semibold text-ink">Read by a model, unverified</p>
                  <p className="text-[11px] text-ink-muted">
                    Nothing stands behind these: a second model read the page differently or could not be asked, or the words quoted for a value do not state it. They are no part of
                    what the document is taken to state.
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {unverified.map((loose, i) => (
                      <li key={`${loose.key}:${i}`} className="text-[12px] text-ink-secondary">
                        <span className="text-ink-muted">{loose.label}:</span> <span className="font-mono">{loose.display}</span>
                        <span className="font-mono text-[10px] text-ink-muted"> · {loose.page ? `said to be on p.${loose.page}` : 'no page named'} · unverified</span>
                        <span className="block text-[11px] leading-snug text-ink-muted">“{loose.quote}”</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <span ref={anchor} hidden />
      {host ? createPortal(popup, host) : null}
    </>
  );
}

/**
 * Whether something else is open over the pop-up, so that Escape is that
 * thing's to take. A menu or a list of choices is in the page only while it
 * is open. A panel with a ground of its own to press outside of lies over
 * everything, the middle of this included.
 */
function openOver(panel: HTMLElement | null): boolean {
  if (!panel) return false;
  for (const el of document.querySelectorAll('[role="menu"], [role="listbox"]')) {
    if (!panel.contains(el) && !el.closest('[inert]')) return true;
  }
  const box = panel.getBoundingClientRect();
  const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return top !== null && !panel.contains(top);
}

function ProofBody({
  state,
  fileName,
  citedPage,
  highlightTerm,
  words,
  marks,
}: {
  state: DocumentSourceState;
  fileName: string;
  citedPage?: number;
  highlightTerm?: string;
  /** The words to look for where there is no page to mark: a Word file. */
  words?: string;
  marks?: { page: number; id: string } & FactMarks;
}) {
  if (state.status === 'loading') {
    return <Shell>Loading the file…</Shell>;
  }
  if (state.status === 'absent') {
    return (
      <Shell>
        <FileWarning size={20} className="text-ink-muted" />
        <p className="text-[13px] text-ink-secondary">This evidence row has no file behind it yet.</p>
        <p className="max-w-[420px] text-center text-[12px] text-ink-muted">
          Attach it in chat or on the register. Any quotes above came from ingest and are not the file.
        </p>
      </Shell>
    );
  }
  if (state.status === 'error') {
    return <Shell>The file could not be read: {state.message}</Shell>;
  }
  const kind = renderKindFor(state.contentType);
  if (kind === 'pdf') {
    return (
      <Suspense fallback={<Shell>Loading the PDF reader…</Shell>}>
        <PdfView
          url={state.url}
          citedPage={citedPage}
          highlight={highlightTerm ? { page: citedPage ?? 1, term: highlightTerm } : undefined}
          marks={marks}
        />
      </Suspense>
    );
  }
  if (kind === 'docx') {
    return (
      <Suspense fallback={<Shell>Loading the document reader…</Shell>}>
        <DocxView blob={state.blob} highlightTerm={words} />
      </Suspense>
    );
  }
  // A picture is one page: a fact's words are marked on it as the reading desk marks them.
  if (kind === 'image') return <ImageView key={state.url} url={state.url} alt={fileName} marks={marks} />;
  if (kind === 'text') return <TextView blob={state.blob} />;
  return (
    <Shell>
      <p className="text-[13px] text-ink-secondary">Nothing here can render a {state.contentType.replace(/^application\//, '')} file.</p>
      <p className="max-w-[420px] text-center text-[12px] text-ink-muted">
        Download it rather than see an approximation. Any quotes above came from ingest.
      </p>
    </Shell>
  );
}

function TextView({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void blob.text().then((t) => {
      if (!cancelled) setText(t);
    });
    return () => {
      cancelled = true;
    };
  }, [blob]);
  if (text === null) return <Shell>Reading the file…</Shell>;
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap bg-white px-8 py-8 font-mono text-[12px] leading-relaxed text-ink">
      {text}
    </pre>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-ink-secondary">{children}</div>;
}
