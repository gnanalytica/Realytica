import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { FileWarning } from 'lucide-react';
import { REVIEW_STANDING_LABEL, cockpitPath, type EvidenceAttachment, type EvidenceRecord, type ReviewCell, type ReviewStanding } from '@realytica/shared';
import { AiMark, cn } from '../ui/kit';
import { fetchEvidenceFile, renderKindFor, type DocumentSourceState } from '../viewer/source';

/* Loaded when a cell is opened: the two readers are the heaviest things in the app, and a table can be read without either. */
const PdfView = lazy(() => import('../viewer/PdfView').then((m) => ({ default: m.PdfView })));
const DocxView = lazy(() => import('../viewer/DocxView').then((m) => ({ default: m.DocxView })));

/** A cell that has something to show on a page. */
export type ShownCell = Extract<ReviewCell, { kind: 'value' | 'answer' | 'found' }>;

export interface ProofOf {
  row: EvidenceRecord;
  file: EvidenceAttachment;
  /** The column's name: a listed value's label, or the question. */
  label: string;
  cell: ShownCell;
}

/** The colour of where a value stands: green for approved, blue for waiting, plain for set aside. */
export function standingClass(standing: ReviewStanding): string {
  return standing === 'approved' ? 'text-[var(--status-good-text)]' : standing === 'waiting' ? 'text-provenance-ink' : 'text-ink-muted';
}

/**
 * Words short enough to sit on one line of a page, which is what the viewer
 * can find and mark where the reader kept no place for them. The whole quote
 * is shown above the page either way.
 */
function needleOf(quote: string): string {
  const flat = quote.replace(/\s+/g, ' ').trim();
  return flat.length <= 60 ? flat : flat.split(' ').slice(0, 6).join(' ');
}

/**
 * A cell's paper, opened at its page with the words marked.
 *
 * It shows and decides nothing. Accepting a value or setting it aside is done
 * on the document, which the link here opens.
 */
export function ReviewProof({ projectId, proof, onClose }: { projectId: string; proof: ProofOf; onClose: () => void }) {
  const { row, file, label, cell } = proof;
  const [state, setState] = useState<DocumentSourceState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    void fetchEvidenceFile(projectId, row.id, file.id, file.fileName, file.mimeType).then((next) => {
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
  }, [projectId, row.id, file.id, file.fileName, file.mimeType]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* The keyboard starts on Close, and goes back to the cell it came from. */
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const from = document.activeElement;
    close.current?.focus();
    return () => {
      if (from instanceof HTMLElement && from.isConnected) from.focus();
    };
  }, []);

  const page = cell.page;
  const quote = cell.quote;
  // Where the reader kept the place of a value's words, that place is marked. Otherwise the words are looked for on the page.
  const marks = cell.kind === 'value' && cell.marks?.quote.length ? { page: cell.page, id: `${row.id}:${label}`, ...cell.marks } : undefined;
  const term = !marks && quote ? needleOf(quote) : undefined;
  const text = cell.kind === 'value' ? cell.display : cell.kind === 'answer' ? cell.text : undefined;

  /*
   * Drawn on the document's own body, over everything. Left inside the page,
   * it is placed by whatever in the page moves or measures itself: a pane on
   * its way in carries a transform, and a box with a transform is what a
   * fixed layer inside it is fixed to.
   */
  return createPortal(
    <div data-layer="modal" className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={`${row.title}, ${label}`} className="relative z-10 flex h-[min(92dvh,56rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-surface shadow-pop ring-1 ring-[var(--ring)]">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-ink">{row.title}</h2>
            <p className="truncate text-[12px] text-ink-muted">
              {file.fileName}
              {page ? `, page ${page}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link to={cockpitPath(projectId, 'evidence', { evidenceId: row.id, ...(page ? { page: String(page) } : {}) })} className="rounded-lg px-2 py-1 text-[12px] font-medium text-brand hover:bg-brand-soft">
              Open in Documents
            </Link>
            <button ref={close} type="button" onClick={onClose} className="h-7 rounded-lg px-2.5 text-xs font-medium text-ink-secondary hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand coarse:min-h-11">
              Close
            </button>
          </div>
        </header>
        <div className="shrink-0 space-y-1 border-b border-hairline bg-sunken px-4 py-2.5">
          <p className="text-[12px] text-ink-muted">{label}</p>
          {text ? <p className={cn('text-[13px] font-medium text-ink', cell.kind === 'value' && cell.standing === 'set_aside' && 'text-ink-muted line-through')}>{text}</p> : null}
          {quote ? <p className="text-[12px] leading-relaxed text-ink-secondary">“{quote}”</p> : null}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {cell.kind === 'value' ? (
              <>
                <span className={cn('font-medium', standingClass(cell.standing))}>{REVIEW_STANDING_LABEL[cell.standing]}</span>
                {cell.aiRead ? (
                  <span className="inline-flex items-center gap-1 text-ai-ink">
                    <AiMark size="xs" /> AI-read
                  </span>
                ) : null}
                {cell.proof ? <span className="text-ink-muted first-letter:uppercase">{cell.proof}</span> : null}
                {cell.note ? <span className="text-provenance-ink">{cell.note}</span> : null}
              </>
            ) : cell.kind === 'answer' ? (
              <>
                <span className="inline-flex items-center gap-1 text-ai-ink">
                  <AiMark size="xs" /> AI-read
                </span>
                {cell.unverified ? (
                  <span className="font-medium text-[var(--status-warning-text)]">Unverified: the words quoted were not found on this page, or do not state the answer’s figures</span>
                ) : (
                  <span className="text-ink-muted">Its words are in the text read from this page</span>
                )}
                {cell.scanned ? <span className="text-ink-muted">The page is a scan, read by OCR</span> : null}
              </>
            ) : (
              <span className="text-ink-muted">Found by a search of the page text. No model is set up.</span>
            )}
          </p>
        </div>
        {/* The dialog has a height of its own, not only a limit: the page viewer fills this box and scrolls inside it only when the box's height is known. */}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-sunken">
          <ProofPage state={state} fileName={file.fileName} page={page} term={term} marks={marks} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProofPage({
  state,
  fileName,
  page,
  term,
  marks,
}: {
  state: DocumentSourceState;
  fileName: string;
  page?: number;
  term?: string;
  marks?: React.ComponentProps<typeof PdfView>['marks'];
}) {
  if (state.status === 'loading') return <Said>Loading the file…</Said>;
  if (state.status === 'absent') {
    return (
      <Said>
        <FileWarning size={20} className="text-ink-muted" />
        <span>The file is not stored on this row.</span>
      </Said>
    );
  }
  if (state.status === 'error') return <Said>The file could not be read: {state.message}</Said>;
  const kind = renderKindFor(state.contentType);
  if (kind === 'pdf') {
    return (
      <Suspense fallback={<Said>Loading the PDF reader…</Said>}>
        <PdfView url={state.url} citedPage={page} highlight={term ? { page: page ?? 1, term } : undefined} marks={marks} />
      </Suspense>
    );
  }
  if (kind === 'docx') {
    return (
      <Suspense fallback={<Said>Loading the document reader…</Said>}>
        <DocxView blob={state.blob} highlightTerm={term} />
      </Suspense>
    );
  }
  if (kind === 'image') {
    return (
      <div className="h-full overflow-auto p-4">
        <img src={state.url} alt={fileName} className="mx-auto block max-w-full bg-white shadow" />
      </div>
    );
  }
  return <Said>This kind of file cannot be shown here. Open it in Documents to download it.</Said>;
}

function Said({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-[13px] text-ink-secondary">{children}</div>;
}
