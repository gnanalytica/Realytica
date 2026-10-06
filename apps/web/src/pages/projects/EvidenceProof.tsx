import { Suspense, lazy, useEffect, useState } from 'react';
import { Download, FileWarning } from 'lucide-react';
import { DOCUMENT_WORKSTREAM, factReview, proofSaid, readingLine, sentToModelLine, soundReading, type DdProject, type DocumentFact, type EvidenceAttachment, type EvidenceRecord, type FactMarks } from '@realytica/shared';
import { OtherReading } from '../../components/reading/FactRow';
import { Button, cn, useToast } from '../../components/ui/kit';
import { api } from '../../lib/api';
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

  useEffect(() => {
    if (!file) {
      setState({ status: 'absent' });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    void fetchEvidenceFile(projectId, evidence.id, file.id, file.fileName, file.mimeType).then((next) => {
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
  }, [projectId, evidence.id, file?.id, file?.fileName, file?.mimeType, file]);

  /*
   * A fact picked in the panel moves the viewer to its page and lights its
   * words. Until one is picked, the citation the caller opened with stands.
   */
  const [picked, setPicked] = useState<DocumentFact | null>(null);
  /* Pointing at a fact shows it as picking it does, until the pointer moves off. */
  const [pointed, setPointed] = useState<DocumentFact | null>(null);
  const shown = pointed ?? picked;
  const page = shown?.page ?? citedPage ?? quotes?.find((q) => q.page)?.page ?? evidence.quotes?.find((q) => q.page)?.page;
  // Where the reader placed the fact's words, the marks are the highlight; the text search is for the rest.
  const marks = shown?.marks?.quote.length ? { page: shown.page, id: `${evidence.id}:${shown.key}`, ...shown.marks } : undefined;
  const term = marks ? undefined : shown?.quote ?? highlightTerm ?? quotes?.[0]?.text ?? evidence.quotes?.[0]?.text;
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 flex max-h-[min(92dvh,56rem)] w-full flex-col overflow-hidden rounded-xl bg-surface shadow-pop ring-1 ring-[var(--ring)]',
          beside ? 'max-w-6xl' : 'max-w-4xl',
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-ink">{evidence.title}</h2>
            <p className="truncate text-[12px] text-ink-muted">
              {file?.fileName ?? 'No file on this row'}
              {evidence.documentType ? ` · read as ${evidence.documentType}` : ''}
              {evidence.readMethod === 'ocr' ? ' · from a scan' : ''}
            </p>
            {offered ? (
              <p className="text-[12px] text-provenance-ink">
                A model takes this for {/^[aeiou]/i.test(offered) ? 'an' : 'a'} {offered.toLowerCase()}. Nobody has confirmed that, so it answers no waiting row.
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
            <Button size="sm" variant="ghost" onClick={onClose}>
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
        <div className={cn('flex min-h-0 flex-1 flex-col', beside && 'md:flex-row')}>
          <div className="min-h-[18rem] min-w-0 flex-1 overflow-hidden bg-sunken">
            <ProofBody state={state} fileName={file?.fileName ?? evidence.title} citedPage={page} highlightTerm={term} marks={marks} />
          </div>
          {beside ? (
            <aside
              aria-label="What this document states"
              className="max-h-[40dvh] shrink-0 overflow-y-auto border-t border-hairline md:max-h-none md:w-[22rem] md:border-l md:border-t-0"
            >
              <div className="sticky top-0 border-b border-hairline bg-surface px-4 py-2.5">
                <p className="text-[12px] font-semibold text-ink">What this document states</p>
                <p className="text-[11px] text-ink-muted">
                  {facts.length
                    ? `${facts.length} fact${facts.length === 1 ? '' : 's'}, each with its page and its own words. Pick one to see it.`
                    : 'Nothing was read from it that could be found on a page.'}
                </p>
              </div>
              <ul className="divide-y divide-hairline">
                {facts.map((fact, i) => {
                  const on = picked?.key === fact.key;
                  // Where it stands: the viewer shows what the document says, not only what was accepted.
                  const review = factReview(fact);
                  return (
                    <li key={`${fact.key}:${i}`}>
                      <button
                        type="button"
                        onClick={() => setPicked(on ? null : fact)}
                        onMouseEnter={() => setPointed(fact)}
                        onMouseLeave={() => setPointed(null)}
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
}

function ProofBody({
  state,
  fileName,
  citedPage,
  highlightTerm,
  marks,
}: {
  state: DocumentSourceState;
  fileName: string;
  citedPage?: number;
  highlightTerm?: string;
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
        <DocxView blob={state.blob} highlightTerm={highlightTerm} />
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
